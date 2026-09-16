/**
 * Worker-preview bootstrap: the one module preview.html adds ahead of the
 * stock entry tag. The runtime's optional source stage owns the pre-Cordis
 * chooser; the unchanged Host connector then owns the Worker handshake.
 * Everything after those calls is the served startup chain verbatim.
 */
import DshWorker from '@aeven/experimental-webworker-runtime/worker?worker'
import {
  chooseWorkerHostSource, connectWorkerHost, IMAGE_FILE_NAME,
} from '@aeven/experimental-webworker-runtime/client'
import { hidePreloader, showPreloader } from '@aeven/client-web/src/preloader.ts'

const image = `preview/${IMAGE_FILE_NAME}`
hidePreloader(false)
const source = await chooseWorkerHostSource({ image })
showPreloader(false)
await connectWorkerHost(new DshWorker({ name: 'dsh-host' }), { image, overlays: source.overlays })
