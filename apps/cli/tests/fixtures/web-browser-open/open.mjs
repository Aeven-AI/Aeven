import { spawn } from 'node:child_process'
import { join } from 'node:path'

const handoffProbe = `
const { writeFileSync } = require('node:fs')
const marker = process.argv[1]
const helperPid = Number(process.argv[2])
setTimeout(() => {
  let helperAlive = true
  if (process.platform === 'win32') {
    try {
      process.kill(helperPid, 0)
    } catch {
      helperAlive = false
    }
  }
  if (helperAlive) writeFileSync(marker, '')
}, 50)
`

export default async function open(url) {
  if (process.env.BROWSER_OPEN_TEST_FAILURE !== undefined) {
    throw new Error(process.env.BROWSER_OPEN_TEST_FAILURE)
  }
  // The shipped Web graph mounts an enforcing identity authority, so the root
  // URL carries no launch token and Connection authorizes the index outright.
  // The served page is the sign-in screen; whoever may act is decided there,
  // not by the address the launcher was handed.
  const response = await fetch(url, { redirect: 'manual' })
  if (response.status !== 200) {
    throw new Error(`browser index request returned HTTP ${response.status}`)
  }
  const html = await response.text()
  console.log(`avn browser-open: ${JSON.stringify({
    url,
    status: response.status,
    bootManifest: html.includes('__DSH_BOOT__'),
    apiKeyPresent: process.env.DEEPSEEK_API_KEY !== undefined,
    avnHomePresent: process.env.AVN_HOME !== undefined,
  })}`)
  // The Windows launcher writes the server-exit marker only while its helper
  // remains alive, so the assembled test detects an early helper exit.
  const launcher = spawn(process.execPath, [
    '--eval', handoffProbe,
    '--', join(process.cwd(), `.avn-browser-open-${process.ppid}`), String(process.pid),
  ], { stdio: 'ignore' })
  launcher.unref()
  return launcher
}
