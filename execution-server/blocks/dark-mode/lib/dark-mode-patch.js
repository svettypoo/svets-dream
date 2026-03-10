// Assembler helper — patches layout.js to wrap with ThemeProvider
// and patches tailwind.config.js to enable darkMode: 'class'
// This file is consumed by assemble-local.js, not imported at runtime

module.exports = {
  layoutPatch: `
// Dark mode: wrap children with ThemeProvider
import { ThemeProvider } from '@/components/ThemeProvider';
// ...add to layout body: <ThemeProvider>{children}</ThemeProvider>
`,
  tailwindPatch: `
// Add to tailwind.config.js:
// darkMode: 'class',
`,
};
