// The self-contained browser bundle has no bundled types. We import it (rather
// than `simple-peer`'s index.js) to avoid webpack Node-polyfill issues; the
// PeerManager treats the instance as `any`, so an untyped module is fine.
declare module 'simple-peer/simplepeer.min.js' {
  const SimplePeer: unknown
  export default SimplePeer
}
