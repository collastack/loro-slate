# loro-slate

A [Slate](https://docs.slatejs.org/) plugin that integrates [Loro CRDT](https://loro.dev) to enable real-time collaborative editing.

## How it works

Slate's document tree is mirrored into a Loro document:

| Slate             | Loro                                              |
| ----------------- | ------------------------------------------------- |
| `Editor.children` | `LoroList` (root `"children"`)                    |
| Element node      | `LoroMap { type, children: LoroList, ... }`       |
| Text node         | `LoroMap { text: LoroText, bold?, italic?, ... }` |

Every local Slate operation is translated into a Loro mutation and committed. Remote Loro events (from other peers) are translated back into Slate operations and applied without re-triggering Loro writes.

## Installation

```bash
npm install loro-slate loro-crdt slate slate-react
```

## Usage

```ts
import { LoroDoc } from 'loro-crdt'
import { createEditor } from 'slate'
import { withReact } from 'slate-react'
import { withLoro, syncSlateValueToLoro, loroDocToSlateValue } from 'loro-slate'

const doc = new LoroDoc()
const editor = withLoro(withReact(createEditor()), { doc })

// Now you can init the doc data from remote snapshot or somewhere
// doc.import(snapshot)
```

Use `loroDocToSlateValue(doc)` to read the current document state back as a Slate value, and pass it as `initialValue` to `<Slate>`.

To sync between peers, forward `doc.subscribeLocalUpdates` bytes to remote peers and call `doc.import(bytes)` on receipt — Loro handles conflict resolution automatically.

## Presence (remote cursors)

`withLoroPresence` adds real-time remote cursor/selection awareness on top of `withLoro`. It uses Loro's `EphemeralStore` — a lightweight, non-persisted pub/sub channel — to broadcast each peer's cursor position.

### Setup

```ts
import { LoroDoc, EphemeralStore } from 'loro-crdt'
import { createEditor } from 'slate'
import { withReact } from 'slate-react'
import { withLoro, withLoroPresence } from 'loro-slate'

const doc = new LoroDoc()
const store = new EphemeralStore()

const editor = withLoroPresence(withLoro(withReact(createEditor()), { doc }), {
  store,
  key: doc.peerIdStr, // stable unique ID for this peer
  user: { name: 'Alice', color: '#e74c3c' },
})
```

Forward the store's local updates to remote peers and import theirs:

```ts
// Send to remote peers
store.subscribeLocalUpdates((bytes) => {
  transport.send(bytes)
})

// Receive from remote peers
transport.onMessage((bytes) => {
  store.import(bytes)
})
```

### Rendering remote cursors (React)

Use the helpers exported from `loro-slate/decoration` (re-exported from `loro-slate`):

```tsx
import { useLoroDecorate, wrapLoroRenderLeaf } from 'loro-slate'
import { Editable } from 'slate-react'

function MyEditor() {
  const decorate = useLoroDecorate(editor)

  const renderLeaf = useCallback(
    wrapLoroRenderLeaf((props) => <DefaultLeaf {...props} />),
    [],
  )

  return <Editable decorate={decorate} renderLeaf={renderLeaf} />
}
```

`useLoroDecorate` subscribes to presence updates and returns a `decorate` function that marks remote peers' selection ranges and caret positions as leaf decorations. `wrapLoroRenderLeaf` wraps your existing `renderLeaf` to render a translucent selection highlight and a blinking named caret for each remote peer.

### Updating user metadata

```ts
editor.presence.setUser({ name: 'Bob', color: '#2980b9' })
```

### Cleanup

```ts
// On unmount / disconnect
editor.presence.disconnect()
editor.disconnect()
```

## API

### `withLoro(editor, options)`

Wraps a Slate editor with Loro synchronization. Returns the editor extended with:

- `editor.doc` — the underlying `LoroDoc`
- `editor.disconnect()` — unsubscribes from Loro events

### `withLoroPresence(editor, options)`

Adds presence awareness to an editor already wrapped with `withLoro`. Options:

| Option  | Type              | Description                                           |
| ------- | ----------------- | ----------------------------------------------------- |
| `store` | `EphemeralStore`  | Shared store instance — the same object on every peer |
| `key`   | `string`          | Stable unique ID for this peer (e.g. `doc.peerIdStr`) |
| `user`  | `{ name, color }` | Optional initial display name and cursor color        |

Returns the editor extended with `editor.presence`:

- `editor.presence.store` — the underlying `EphemeralStore`
- `editor.presence.key` — this peer's key
- `editor.presence.setUser(user)` — update display name / color
- `editor.presence.getAll()` — returns all peers' decoded `PresenceState`
- `editor.presence.disconnect()` — removes this peer's entry from the store

### `useLoroDecorate(editor)`

React hook. Returns a `decorate` callback for `<Editable>` that annotates leaf nodes with remote peers' selection ranges and caret positions.

### `wrapLoroRenderLeaf(renderLeaf)`

Higher-order function. Wraps your `renderLeaf` to render selection highlights and blinking carets for remote peers.

### `syncSlateValueToLoro(doc, value)`

Writes a Slate `Descendant[]` value into a `LoroDoc`. Use this once to initialize the document.

### `loroDocToSlateValue(doc)`

Reads a `LoroDoc` and returns the equivalent Slate `Descendant[]` value.

## Development

```bash
bun install
bun dev   # starts the demo app (two syncing editor peers)
```

## Peer dependencies

- `loro-crdt` ^1.10.6
- `slate` ^0.123.0
- `slate-react` ^0.123.0
