import { LoroDoc, LoroList, LoroMap, LoroText } from 'loro-crdt'
import { createEditor, Editor, Transforms, type Descendant } from 'slate'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  loroDocToSlateValue,
  syncSlateValueToLoro,
  withLoro,
} from './with-loro'

function createTextBlock(text: string): Descendant {
  return {
    type: 'paragraph',
    children: [{ text }],
  } as Descendant
}

function createTestEditor(doc: LoroDoc) {
  const editor = createEditor()
  return withLoro(editor, {
    doc,
    emptyLine: createTextBlock(''),
  })
}

function getBlockTexts(editor: Editor): string[] {
  return editor.children.map((node) => {
    const element = node as { children: { text: string }[] }
    return element.children[0]?.text ?? ''
  })
}

function getLoroBlockTexts(doc: LoroDoc): string[] {
  const children = doc.getList('children')
  const texts: string[] = []
  for (let i = 0; i < children.length; i++) {
    const map = children.get(i) as LoroMap
    const childList = map.get('children') as LoroList
    const textMap = childList.get(0) as LoroMap
    const loroText = textMap.get('text') as LoroText
    texts.push(loroText.toString())
  }
  return texts
}

describe('withLoro move_node operations', () => {
  let doc: LoroDoc
  let editor: ReturnType<typeof createTestEditor>

  beforeEach(() => {
    doc = new LoroDoc()
    editor = createTestEditor(doc)

    const initialValue: Descendant[] = [
      createTextBlock('A'),
      createTextBlock('B'),
      createTextBlock('C'),
    ]
    syncSlateValueToLoro(doc, initialValue)
    editor.children = loroDocToSlateValue(doc)
  })

  describe('same-parent moves', () => {
    it('should move block forward: [A,B,C] move A to after B -> [B,A,C]', () => {
      // Move from [0] to [1] - A should end up at index 1
      Transforms.moveNodes(editor, { at: [0], to: [1] })

      const slateTexts = getBlockTexts(editor)
      const loroTexts = getLoroBlockTexts(doc)

      // Both Slate and Loro should have the same order
      expect(slateTexts).toEqual(['B', 'A', 'C'])
      expect(loroTexts).toEqual(['B', 'A', 'C'])
    })

    it('should move block forward: [A,B,C] move A to after C -> [B,C,A]', () => {
      // Move from [0] to [2] - A should end up at index 2 (last)
      Transforms.moveNodes(editor, { at: [0], to: [2] })

      const slateTexts = getBlockTexts(editor)
      const loroTexts = getLoroBlockTexts(doc)

      expect(slateTexts).toEqual(['B', 'C', 'A'])
      expect(loroTexts).toEqual(['B', 'C', 'A'])
    })

    it('should move block backward: [A,B,C] move C to before A -> [C,A,B]', () => {
      // Move from [2] to [0] - C should end up at index 0
      Transforms.moveNodes(editor, { at: [2], to: [0] })

      const slateTexts = getBlockTexts(editor)
      const loroTexts = getLoroBlockTexts(doc)

      expect(slateTexts).toEqual(['C', 'A', 'B'])
      expect(loroTexts).toEqual(['C', 'A', 'B'])
    })

    it('should move block backward: [A,B,C] move C to before B -> [A,C,B]', () => {
      // Move from [2] to [1] - C should end up at index 1
      Transforms.moveNodes(editor, { at: [2], to: [1] })

      const slateTexts = getBlockTexts(editor)
      const loroTexts = getLoroBlockTexts(doc)

      expect(slateTexts).toEqual(['A', 'C', 'B'])
      expect(loroTexts).toEqual(['A', 'C', 'B'])
    })

    it('should move middle block forward: [A,B,C] move B to after C -> [A,C,B]', () => {
      // Move from [1] to [2] - B should end up at index 2
      Transforms.moveNodes(editor, { at: [1], to: [2] })

      const slateTexts = getBlockTexts(editor)
      const loroTexts = getLoroBlockTexts(doc)

      expect(slateTexts).toEqual(['A', 'C', 'B'])
      expect(loroTexts).toEqual(['A', 'C', 'B'])
    })

    it('should move middle block backward: [A,B,C] move B to before A -> [B,A,C]', () => {
      // Move from [1] to [0] - B should end up at index 0
      Transforms.moveNodes(editor, { at: [1], to: [0] })

      const slateTexts = getBlockTexts(editor)
      const loroTexts = getLoroBlockTexts(doc)

      expect(slateTexts).toEqual(['B', 'A', 'C'])
      expect(loroTexts).toEqual(['B', 'A', 'C'])
    })
  })

  describe('edge cases with 4+ blocks', () => {
    beforeEach(() => {
      const fourBlocks: Descendant[] = [
        createTextBlock('A'),
        createTextBlock('B'),
        createTextBlock('C'),
        createTextBlock('D'),
      ]
      syncSlateValueToLoro(doc, fourBlocks)
      editor.children = loroDocToSlateValue(doc)
    })

    it('should move first to last: [A,B,C,D] move A to end -> [B,C,D,A]', () => {
      Transforms.moveNodes(editor, { at: [0], to: [3] })

      const slateTexts = getBlockTexts(editor)
      const loroTexts = getLoroBlockTexts(doc)

      expect(slateTexts).toEqual(['B', 'C', 'D', 'A'])
      expect(loroTexts).toEqual(['B', 'C', 'D', 'A'])
    })

    it('should move last to first: [A,B,C,D] move D to start -> [D,A,B,C]', () => {
      Transforms.moveNodes(editor, { at: [3], to: [0] })

      const slateTexts = getBlockTexts(editor)
      const loroTexts = getLoroBlockTexts(doc)

      expect(slateTexts).toEqual(['D', 'A', 'B', 'C'])
      expect(loroTexts).toEqual(['D', 'A', 'B', 'C'])
    })

    it('should move first to middle: [A,B,C,D] move A to index 2 -> [B,C,A,D]', () => {
      Transforms.moveNodes(editor, { at: [0], to: [2] })

      const slateTexts = getBlockTexts(editor)
      const loroTexts = getLoroBlockTexts(doc)

      expect(slateTexts).toEqual(['B', 'C', 'A', 'D'])
      expect(loroTexts).toEqual(['B', 'C', 'A', 'D'])
    })
  })

  describe('cross-parent moves', () => {
    function createNestedBlock(children: Descendant[]): Descendant {
      return {
        type: 'container',
        children,
      } as unknown as Descendant
    }

    function getNestedLoroTexts(loroDoc: LoroDoc): string[][] {
      const result: string[][] = []
      const topChildren = loroDoc.getList('children')
      for (let i = 0; i < topChildren.length; i++) {
        const topMap = topChildren.get(i) as LoroMap
        const nestedChildren = topMap.get('children') as LoroList
        const texts: string[] = []
        for (let j = 0; j < nestedChildren.length; j++) {
          const childMap = nestedChildren.get(j) as LoroMap
          const grandChildren = childMap.get('children') as LoroList
          if (grandChildren) {
            const textMap = grandChildren.get(0) as LoroMap
            const loroText = textMap.get('text') as string
            texts.push(loroText.toString())
          }
        }
        result.push(texts)
      }
      return result
    }

    it('should move from first container to second: [[A,B], [C]] move A to second -> [[B], [A,C]]', () => {
      const nested: Descendant[] = [
        createNestedBlock([createTextBlock('A'), createTextBlock('B')]),
        createNestedBlock([createTextBlock('C')]),
      ]
      syncSlateValueToLoro(doc, nested)
      editor.children = loroDocToSlateValue(doc)

      // Move [0,0] (A) to [1,0] (before C in second container)
      Transforms.moveNodes(editor, { at: [0, 0], to: [1, 0] })

      const slateResult = editor.children.map((container) =>
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        container.children.map((child) => child.children[0]?.text ?? ''),
      )
      const loroResult = getNestedLoroTexts(doc)

      expect(slateResult).toEqual([['B'], ['A', 'C']])
      expect(loroResult).toEqual([['B'], ['A', 'C']])
    })

    it('should move from second container to first: [[A], [B,C]] move B to first -> [[A,B], [C]]', () => {
      const nested: Descendant[] = [
        createNestedBlock([createTextBlock('A')]),
        createNestedBlock([createTextBlock('B'), createTextBlock('C')]),
      ]
      syncSlateValueToLoro(doc, nested)
      editor.children = loroDocToSlateValue(doc)

      // Move [1,0] (B) to [0,1] (after A in first container)
      Transforms.moveNodes(editor, { at: [1, 0], to: [0, 1] })

      const slateResult = editor.children.map((container) =>
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        container.children.map((child) => child.children[0]?.text ?? ''),
      )
      const loroResult = getNestedLoroTexts(doc)

      expect(slateResult).toEqual([['A', 'B'], ['C']])
      expect(loroResult).toEqual([['A', 'B'], ['C']])
    })
  })
})
