import { createServiceClient } from '@/lib/supabase-server'

// Lazy-load dockerode to avoid crash if not installed
let Docker = null
function getDocker() {
  if (!Docker) {
    try {
      Docker = require('dockerode')
    } catch {
      throw new Error('Docker not available. Install Docker Desktop and ensure it is running.')
    }
  }
  // Windows Docker Desktop: try named pipe, fallback to TCP
  try {
    return new Docker({ socketPath: '//./pipe/docker_engine' })
  } catch {
    return new Docker({ host: '127.0.0.1', port: 2375 })
  }
}

export async function listVMs(userId) {
  const db = createServiceClient()
  const { data, error } = await db
    .from('user_vms')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data || []
}

export async function createVM(userId, { name, image = 'ubuntu:22.04', memoryMb = 512 }) {
  const docker = getDocker()
  const db = createServiceClient()

  // Pull image first (non-blocking check)
  try {
    await new Promise((resolve, reject) => {
      docker.pull(image, (err, stream) => {
        if (err) return reject(err)
        docker.modem.followProgress(stream, (err) => err ? reject(err) : resolve())
      })
    })
  } catch (e) {
    throw new Error(`Failed to pull image "${image}": ${e.message}`)
  }

  const container = await docker.createContainer({
    Image: image,
    name: `svet-vm-${userId.slice(0, 8)}-${Date.now()}`,
    Cmd: ['/bin/bash'],
    Tty: true,
    OpenStdin: true,
    HostConfig: {
      Memory: memoryMb * 1024 * 1024,
      NanoCpus: 500000000, // 0.5 CPU
      RestartPolicy: { Name: 'unless-stopped' },
    },
  })

  await container.start()

  const { data, error } = await db.from('user_vms').insert({
    user_id: userId,
    name: name || `VM ${new Date().toLocaleDateString()}`,
    container_id: container.id,
    image,
    status: 'running',
    memory_mb: memoryMb,
  }).select().single()

  if (error) {
    // Clean up container if DB insert fails
    try { await container.stop(); await container.remove() } catch {}
    throw new Error(error.message)
  }
  return data
}

export async function getVM(vmId, userId) {
  const db = createServiceClient()
  const { data, error } = await db
    .from('user_vms')
    .select('*')
    .eq('id', vmId)
    .eq('user_id', userId)
    .single()
  if (error) throw new Error('VM not found')
  return data
}

export async function startVM(vmId, userId) {
  const vm = await getVM(vmId, userId)
  if (!vm.container_id) throw new Error('No container ID for this VM')

  const docker = getDocker()
  const container = docker.getContainer(vm.container_id)
  await container.start()

  const db = createServiceClient()
  await db.from('user_vms').update({ status: 'running' }).eq('id', vmId)
  return { ...vm, status: 'running' }
}

export async function stopVM(vmId, userId) {
  const vm = await getVM(vmId, userId)
  if (!vm.container_id) throw new Error('No container ID for this VM')

  const docker = getDocker()
  const container = docker.getContainer(vm.container_id)
  try { await container.stop({ t: 5 }) } catch (e) {
    if (!e.message?.includes('already stopped')) throw e
  }

  const db = createServiceClient()
  await db.from('user_vms').update({ status: 'stopped' }).eq('id', vmId)
  return { ...vm, status: 'stopped' }
}

export async function destroyVM(vmId, userId) {
  const vm = await getVM(vmId, userId)
  const docker = getDocker()

  if (vm.container_id) {
    const container = docker.getContainer(vm.container_id)
    try { await container.stop({ t: 2 }) } catch {}
    try { await container.remove({ force: true }) } catch {}
  }

  const db = createServiceClient()
  await db.from('user_vms').delete().eq('id', vmId)
}

export async function execInVM(vmId, userId, command, timeoutMs = 30000) {
  const vm = await getVM(vmId, userId)
  if (vm.status !== 'running') throw new Error('VM is not running. Start it first.')
  if (!vm.container_id) throw new Error('No container ID for this VM')

  const docker = getDocker()
  const container = docker.getContainer(vm.container_id)

  const exec = await container.exec({
    Cmd: ['/bin/bash', '-c', command],
    AttachStdout: true,
    AttachStderr: true,
  })

  const output = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Command timed out after 30s')), timeoutMs)
    exec.start({ hijack: true, stdin: false }, (err, stream) => {
      if (err) { clearTimeout(timeout); return reject(err) }
      let stdout = '', stderr = ''
      stream.on('data', (chunk) => {
        // Docker multiplexed stream: first 8 bytes are header
        if (chunk.length > 8) {
          const streamType = chunk[0] // 1=stdout, 2=stderr
          const payload = chunk.slice(8).toString('utf8')
          if (streamType === 1) stdout += payload
          else stderr += payload
        } else {
          stdout += chunk.toString('utf8')
        }
      })
      stream.on('end', () => {
        clearTimeout(timeout)
        resolve({ stdout, stderr })
      })
      stream.on('error', (e) => { clearTimeout(timeout); reject(e) })
    })
  })

  // Update last_used_at
  const db = createServiceClient()
  await db.from('user_vms').update({ last_used_at: new Date().toISOString() }).eq('id', vmId)

  return output
}

export async function getVMStatus(vmId, userId) {
  const vm = await getVM(vmId, userId)
  if (!vm.container_id) return { ...vm, dockerStatus: 'no-container' }

  try {
    const docker = getDocker()
    const container = docker.getContainer(vm.container_id)
    const info = await container.inspect()
    const dockerStatus = info.State.Running ? 'running' : 'stopped'

    // Sync status to DB if mismatched
    if (dockerStatus !== vm.status) {
      const db = createServiceClient()
      await db.from('user_vms').update({ status: dockerStatus }).eq('id', vmId)
    }

    return { ...vm, status: dockerStatus, dockerInfo: { cpu: info.HostConfig.NanoCpus, memory: info.HostConfig.Memory } }
  } catch (e) {
    return { ...vm, dockerStatus: 'error', dockerError: e.message }
  }
}

// Get or create a "default" VM for an agent to use
export async function getOrCreateAgentVM(userId) {
  const db = createServiceClient()
  const { data } = await db
    .from('user_vms')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'running')
    .order('last_used_at', { ascending: false })
    .limit(1)

  if (data && data.length > 0) return data[0]

  // Create a new one
  return createVM(userId, {
    name: 'Agent Workspace',
    image: 'ubuntu:22.04',
    memoryMb: 1024,
  })
}
