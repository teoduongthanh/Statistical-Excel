import { cpSync, existsSync, mkdirSync } from 'node:fs'

const copyDirectory = (source, destination) => {
  if (!existsSync(source)) return
  mkdirSync(destination, { recursive: true })
  cpSync(source, destination, { recursive: true, force: true })
}

copyDirectory('.next/static', '.next/standalone/.next/static')
copyDirectory('public', '.next/standalone/public')

console.log('Standalone assets copied successfully.')
