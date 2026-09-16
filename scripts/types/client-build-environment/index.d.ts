/** Build-time values that bundlers replace before client code reaches a browser. */
declare const process: {
  readonly env: {
    readonly NODE_ENV?: string
    readonly [name: `AVN_CLIENT_${string}`]: string | undefined
  }
}
