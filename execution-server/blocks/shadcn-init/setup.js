/**
 * shadcn-init block
 * Wires up shadcn/ui as the component foundation.
 * Run during assembly: node setup.js <appDir>
 *
 * What it does:
 *   - Adds shadcn/ui dependencies to package.json
 *   - Writes components.json (shadcn config)
 *   - Updates tailwind.config.js with CSS variable support
 *   - Updates globals.css with shadcn CSS variables
 *   - Adds lib/utils.js (cn() helper)
 *
 * After assembly, user runs: npx shadcn@latest add <component>
 * e.g. npx shadcn@latest add button input table dialog select
 */

const fs = require('fs')
const path = require('path')

module.exports = function shadcnInit(appDir, config = {}) {
  const primaryColor = config.primaryColor || '#6366f1'

  // components.json — shadcn config
  const componentsJson = {
    $schema: 'https://ui.shadcn.com/schema.json',
    style: 'default',
    rsc: true,
    tsx: false,
    tailwind: {
      config: 'tailwind.config.js',
      css: 'app/globals.css',
      baseColor: 'slate',
      cssVariables: true,
    },
    aliases: {
      components: '@/components',
      utils: '@/lib/utils',
    },
  }
  fs.writeFileSync(path.join(appDir, 'components.json'), JSON.stringify(componentsJson, null, 2))
  console.log('   + components.json')

  // lib/utils.js — cn() helper used by all shadcn components
  const utilsContent = `import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}
`
  fs.mkdirSync(path.join(appDir, 'lib'), { recursive: true })
  fs.writeFileSync(path.join(appDir, 'lib/utils.js'), utilsContent)
  console.log('   + lib/utils.js')

  // Patch package.json — add shadcn peer deps
  const pkgPath = path.join(appDir, 'package.json')
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    pkg.dependencies = {
      ...pkg.dependencies,
      'clsx': '^2.1.1',
      'tailwind-merge': '^2.4.0',
      'class-variance-authority': '^0.7.0',
      'lucide-react': '^0.400.0',
      '@radix-ui/react-slot': '^1.1.0',
      '@radix-ui/react-dialog': '^1.1.0',
      '@radix-ui/react-dropdown-menu': '^2.1.0',
      '@radix-ui/react-select': '^2.1.0',
      '@radix-ui/react-toast': '^1.2.0',
      '@radix-ui/react-tabs': '^1.1.0',
      '@radix-ui/react-label': '^2.1.0',
      '@radix-ui/react-checkbox': '^1.1.0',
      '@radix-ui/react-avatar': '^1.1.0',
    }
    pkg.devDependencies = {
      ...pkg.devDependencies,
      'tailwindcss-animate': '^1.0.7',
    }
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))
    console.log('   ✎ Patched package.json → added shadcn/ui deps')
  }

  // Patch tailwind.config.js — add shadcn plugin + CSS vars
  const tcPath = path.join(appDir, 'tailwind.config.js')
  if (fs.existsSync(tcPath)) {
    let tc = fs.readFileSync(tcPath, 'utf8')
    if (!tc.includes('tailwindcss-animate')) {
      tc = tc.replace("plugins: []", "plugins: [require('tailwindcss-animate')]")
      tc = tc.replace("plugins: [", "plugins: [require('tailwindcss-animate'), ")
      fs.writeFileSync(tcPath, tc)
      console.log('   ✎ Patched tailwind.config.js → added tailwindcss-animate')
    }
  }

  // Patch globals.css — add CSS variables for shadcn
  const cssPath = path.join(appDir, 'app/globals.css')
  if (fs.existsSync(cssPath)) {
    let css = fs.readFileSync(cssPath, 'utf8')
    if (!css.includes('--background')) {
      const vars = `
@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 222.2 84% 4.9%;
    --primary: 221.2 83.2% 53.3%;
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    --ring: 221.2 83.2% 53.3%;
    --radius: 0.5rem;
  }
  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    --card: 222.2 84% 4.9%;
    --card-foreground: 210 40% 98%;
    --primary: 217.2 91.2% 59.8%;
    --primary-foreground: 222.2 47.4% 11.2%;
    --secondary: 217.2 32.6% 17.5%;
    --secondary-foreground: 210 40% 98%;
    --muted: 217.2 32.6% 17.5%;
    --muted-foreground: 215 20.2% 65.1%;
    --border: 217.2 32.6% 17.5%;
    --input: 217.2 32.6% 17.5%;
    --ring: 224.3 76.3% 48%;
  }
}
`
      css = css + vars
      fs.writeFileSync(cssPath, css)
      console.log('   ✎ Patched app/globals.css → added CSS variable layer')
    }
  }

  console.log('   ✓ shadcn-init done')
  console.log('   → Run: npx shadcn@latest add button input table dialog select tabs avatar badge')
}
