/** Plain stylesheet imports carry no exports; this states that for the compiler. */
declare module '*.css' {
  const content: string
  export default content
}
