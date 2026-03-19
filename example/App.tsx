import { useCallback, useEffect, useMemo, useState } from 'react'
import { createEditor, Editor, type Descendant, type NodeEntry } from 'slate'
import { Editable, Slate, withReact } from 'slate-react'
import { EphemeralStore, LoroDoc, LoroList, LoroMap, LoroText } from 'loro-crdt'
import {
  withLoro,
  withLoroPresence,
  syncSlateValueToLoro,
  loroDocToSlateValue,
  useLoroDecorate,
  wrapLoroRenderLeaf,
  CursorOverlay,
  type PresenceMap,
} from '../src/index.ts'
import './types.ts'
import { renderElement } from './renderElement.tsx'
import { renderLeaf } from './renderLeaf.tsx'
import { makeDecorate } from './decorate.ts'
import { Toolbar } from './toolbar.tsx'
import type { MarkFormat } from './types.ts'

// ── keyboard shortcut map ──────────────────────────────────

const HOTKEYS: Record<string, MarkFormat> = {
  b: 'bold',
  i: 'italic',
  u: 'underline',
}

// ── rich initial content ───────────────────────────────────

const INITIAL_VALUE: Descendant[] = [
  {
    type: 'heading',
    level: 1,
    children: [{ text: 'loro-slate Rich Text Demo' }],
  },
  {
    type: 'paragraph',
    children: [
      { text: 'This paragraph contains ' },
      { text: 'bold', bold: true },
      { text: ', ' },
      { text: 'italic', italic: true },
      { text: ', ' },
      { text: 'underline', underline: true },
      { text: ', ' },
      { text: 'strikethrough', strikethrough: true },
      { text: ', and ' },
      { text: 'inline code', code: true },
      { text: ' formatting.' },
    ],
  },
  {
    type: 'blockquote',
    children: [
      {
        type: 'paragraph',
        children: [
          {
            text: 'The best way to predict the future is to invent it. — Alan Kay',
          },
        ],
      },
    ],
  },
  {
    type: 'heading',
    level: 2,
    children: [{ text: 'Code Block' }],
  },
  {
    type: 'code-block',
    language: 'javascript',
    children: [
      { text: 'function greet(name) {\n  return `Hello, ${name}!`;\n}' },
    ],
  },
  {
    type: 'heading',
    level: 2,
    children: [{ text: 'Lists' }],
  },
  {
    type: 'bulleted-list',
    children: [
      { type: 'list-item', children: [{ text: 'First bullet point' }] },
      { type: 'list-item', children: [{ text: 'Second bullet point' }] },
      { type: 'list-item', children: [{ text: 'Third bullet point' }] },
    ],
  },
  {
    type: 'heading',
    level: 2,
    children: [{ text: 'Table' }],
  },
  {
    type: 'table',
    children: [
      {
        type: 'table-row',
        children: [
          { type: 'table-cell', children: [{ text: 'Feature' }] },
          { type: 'table-cell', children: [{ text: 'Status' }] },
          { type: 'table-cell', children: [{ text: 'Notes' }] },
        ],
      },
      {
        type: 'table-row',
        children: [
          { type: 'table-cell', children: [{ text: 'Rich text' }] },
          { type: 'table-cell', children: [{ text: '✓' }] },
          { type: 'table-cell', children: [{ text: 'Bold, italic, etc.' }] },
        ],
      },
      {
        type: 'table-row',
        children: [
          { type: 'table-cell', children: [{ text: 'Collaboration' }] },
          { type: 'table-cell', children: [{ text: '✓' }] },
          { type: 'table-cell', children: [{ text: 'Via Loro CRDT' }] },
        ],
      },
    ],
  },
]

// ── styles ─────────────────────────────────────────────────

const rootStyle: React.CSSProperties = {
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  maxWidth: 1800,
  margin: '0 auto',
  padding: '32px 24px',
}

const headerStyle: React.CSSProperties = {
  textAlign: 'center',
  marginBottom: 32,
}

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 24,
}

const panelStyle: React.CSSProperties = {
  border: '1px solid #d0d7de',
  borderRadius: 8,
  overflow: 'hidden',
}

const labelStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 600,
  color: '#fff',
  userSelect: 'none',
}

const editableStyle: React.CSSProperties = {
  padding: '16px 20px',
  minHeight: 200,
  outline: 'none',
  lineHeight: 1.6,
  fontSize: 15,
}

// ── loro data serializer ───────────────────────────────────

function serializeLoroMap(map: LoroMap): Record<string, unknown> {
  const obj: Record<string, unknown> = {}
  for (const [k, v] of map.entries()) {
    if (v instanceof LoroMap) {
      obj[`[LoroMap] ${k}`] = serializeLoroMap(v)
    } else if (v instanceof LoroList) {
      obj[`[LoroList] ${k}`] = serializeLoroListItems(v)
    } else if (v instanceof LoroText) {
      obj[`[LoroText] ${k}`] = v.toString()
    } else {
      obj[k] = v
    }
  }
  return obj
}

function serializeLoroListItems(list: LoroList): unknown[] {
  const arr: unknown[] = []
  for (let i = 0; i < list.length; i++) {
    const item = list.get(i)
    arr.push(item instanceof LoroMap ? serializeLoroMap(item) : item)
  }
  return arr
}

function serializeLoroDoc(doc: LoroDoc): unknown {
  return {
    '[LoroDoc] children': serializeLoroListItems(doc.getList('children')),
  }
}

// ── json syntax highlighter ────────────────────────────────

function syntaxHighlight(json: string): string {
  return json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(
      /("(\[Loro(?:Map|List|Text)\])"(\s*):)/g,
      '<span style="color:#8250df;font-weight:600">$1</span>',
    )
    .replace(
      /("(?!\[Loro)(?:[^"\\]|\\.)*"(\s*):)/g,
      '<span style="color:#0969da">$1</span>',
    )
    .replace(
      /: ("(?:[^"\\]|\\.)*")/g,
      ': <span style="color:#0a3069">$1</span>',
    )
    .replace(/: (true|false)/g, ': <span style="color:#cf222e">$1</span>')
    .replace(/: (\d+)/g, ': <span style="color:#0550ae">$1</span>')
}

// ── data panel component ───────────────────────────────────

function DataPanel({
  loroData,
  slateData,
}: {
  loroData: unknown
  slateData: Descendant[]
}) {
  const loroJson = JSON.stringify(loroData, null, 2)
  const slateJson = JSON.stringify(slateData, null, 2)

  return (
    <div style={dataPanelWrapStyle}>
      <div style={dataPanelColStyle}>
        <div style={dataPanelHeaderStyle}>
          <span style={dataTypeBadgeStyle('#8250df')}>Loro</span>
          data structure
        </div>
        <pre
          style={dataPreStyle}
          dangerouslySetInnerHTML={{ __html: syntaxHighlight(loroJson) }}
        />
      </div>
      <div style={dataPanelColStyle}>
        <div style={dataPanelHeaderStyle}>
          <span style={dataTypeBadgeStyle('#0969da')}>Slate</span>
          value
        </div>
        <pre
          style={dataPreStyle}
          dangerouslySetInnerHTML={{ __html: syntaxHighlight(slateJson) }}
        />
      </div>
    </div>
  )
}

const dataPanelWrapStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 0,
  borderTop: '1px solid #d0d7de',
}

const dataPanelColStyle: React.CSSProperties = {
  overflow: 'hidden',
  borderRight: '1px solid #d0d7de',
}

const dataPanelHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 12px',
  fontSize: 12,
  fontWeight: 600,
  color: '#656d76',
  background: '#f6f8fa',
  borderBottom: '1px solid #d0d7de',
  borderTop: '1px solid #d0d7de',
  userSelect: 'none',
}

function dataTypeBadgeStyle(color: string): React.CSSProperties {
  return {
    display: 'inline-block',
    padding: '1px 7px',
    borderRadius: 10,
    fontSize: 11,
    fontWeight: 700,
    color: '#fff',
    background: color,
    letterSpacing: 0.3,
  }
}

const dataPreStyle: React.CSSProperties = {
  margin: 0,
  padding: '12px 14px',
  fontSize: 11.5,
  lineHeight: 1.55,
  overflowX: 'auto',
  overflowY: 'auto',
  maxHeight: 320,
  background: '#fff',
  fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
}

const PEER_COLORS = ['#0969da', '#8250df'] as const

function peerLabelStyle(idx: number): React.CSSProperties {
  return { ...labelStyle, background: PEER_COLORS[idx] }
}

// ── single editor component ────────────────────────────────

function PeerEditor({
  doc,
  peerIdx,
  peerKey,
  store,
  onLocalUpdate,
}: {
  doc: LoroDoc
  peerIdx: number
  peerKey: string
  store: EphemeralStore<PresenceMap>
  onLocalUpdate: (update: Uint8Array) => void
}) {
  const editor = useMemo(
    () =>
      withLoroPresence(
        withLoro(withReact(createEditor()), {
          doc,
          emptyLine: { type: 'paragraph', children: [{ text: '' }] },
        }),
        {
          store,
          key: peerKey,
          user: { name: `Peer ${peerIdx + 1}`, color: PEER_COLORS[peerIdx] },
        },
      ),
    // store and peerKey are stable references
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc],
  )

  const initialValue = useMemo(() => loroDocToSlateValue(doc), [doc])
  const codeDecorate = useMemo(() => makeDecorate(editor), [editor])
  const loroDecorate = useLoroDecorate(editor)
  const decorate = useCallback(
    (entry: NodeEntry) => [...codeDecorate(entry), ...loroDecorate(entry)],
    [codeDecorate, loroDecorate],
  )
  const wrappedRenderLeaf = useMemo(() => wrapLoroRenderLeaf(renderLeaf), [])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorForOverlay = editor as any

  const [showData, setShowData] = useState(false)
  const [loroData, setLoroData] = useState<unknown>(() => serializeLoroDoc(doc))
  const [slateData, setSlateData] = useState<Descendant[]>(initialValue)

  useEffect(() => {
    return doc.subscribeLocalUpdates((bytes) => onLocalUpdate(bytes))
  }, [doc, onLocalUpdate])

  useEffect(() => {
    return () => {
      editor.presence.disconnect()
    }
  }, [editor])

  useEffect(() => {
    return doc.subscribe(() => {
      setLoroData(serializeLoroDoc(doc))
    })
  }, [doc])

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!(event.metaKey || event.ctrlKey)) return
      const key = event.key.toLowerCase()
      const mark = HOTKEYS[key]
      if (mark) {
        event.preventDefault()
        const marks = Editor.marks(editor) as Record<string, unknown> | null
        if (marks?.[mark]) {
          Editor.removeMark(editor, mark)
        } else {
          Editor.addMark(editor, mark, true)
        }
      }
    },
    [editor],
  )

  const handleChange = useCallback((value: Descendant[]) => {
    setSlateData(value)
  }, [])

  return (
    <div style={panelStyle}>
      <div
        style={{
          ...peerLabelStyle(peerIdx),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span>Peer {peerIdx + 1}</span>
        <button onClick={() => setShowData((v) => !v)} style={toggleBtnStyle}>
          {showData ? 'Hide data' : 'Show data'}
        </button>
      </div>
      <Slate
        editor={editor}
        initialValue={initialValue}
        onChange={handleChange}
      >
        <Toolbar />
        <CursorOverlay editor={editorForOverlay}>
          <Editable
            style={editableStyle}
            renderElement={renderElement}
            renderLeaf={wrappedRenderLeaf}
            decorate={decorate}
            onKeyDown={onKeyDown}
            placeholder="Type something…"
          />
        </CursorOverlay>
      </Slate>
      {showData && <DataPanel loroData={loroData} slateData={slateData} />}
    </div>
  )
}

const toggleBtnStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.2)',
  border: '1px solid rgba(255,255,255,0.4)',
  borderRadius: 4,
  color: '#fff',
  fontSize: 11,
  fontWeight: 600,
  padding: '2px 10px',
  cursor: 'pointer',
  letterSpacing: 0.2,
}

// ── app: two peers syncing via in-memory updates ───────────

export function App() {
  const [docs] = useState(() => {
    const docA = new LoroDoc()
    docA.setPeerId('1')
    const docB = new LoroDoc()
    docB.setPeerId('2')

    syncSlateValueToLoro(docA, INITIAL_VALUE)
    const snapshot = docA.export({ mode: 'snapshot' })
    docB.import(snapshot)

    return [docA, docB] as const
  })

  const [stores] = useState<
    readonly [EphemeralStore<PresenceMap>, EphemeralStore<PresenceMap>]
  >(() => {
    const storeA = new EphemeralStore<PresenceMap>()
    const storeB = new EphemeralStore<PresenceMap>()
    storeA.subscribeLocalUpdates((bytes: Uint8Array) => storeB.apply(bytes))
    storeB.subscribeLocalUpdates((bytes: Uint8Array) => storeA.apply(bytes))
    return [storeA, storeB] as const
  })

  const syncAtoB = useCallback(
    (update: Uint8Array) => docs[1].import(update),
    [docs],
  )
  const syncBtoA = useCallback(
    (update: Uint8Array) => docs[0].import(update),
    [docs],
  )

  return (
    <div style={rootStyle}>
      <div style={headerStyle}>
        <h1 style={{ fontSize: 22, margin: 0 }}>loro-slate demo</h1>
        <p style={{ color: '#656d76', margin: '8px 0 0' }}>
          Two Slate editors syncing via Loro CRDT — now with rich text blocks
        </p>
      </div>
      <div style={gridStyle}>
        <PeerEditor
          doc={docs[0]}
          peerIdx={0}
          peerKey="1"
          store={stores[0]}
          onLocalUpdate={syncAtoB}
        />
        <PeerEditor
          doc={docs[1]}
          peerIdx={1}
          peerKey="2"
          store={stores[1]}
          onLocalUpdate={syncBtoA}
        />
      </div>
    </div>
  )
}
