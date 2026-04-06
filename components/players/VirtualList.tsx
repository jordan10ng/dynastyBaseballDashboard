'use client'
import { useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react'

type Props = {
  itemCount: number
  itemSize: number
  height: number
  width: string
  style?: React.CSSProperties
  onHScroll?: (scrollLeft: number) => void
  children: (props: { index: number; style: React.CSSProperties }) => React.ReactNode
}

export const FixedSizeList = forwardRef<{ scrollTo: (offset: number) => void }, Props>(
  function FixedSizeList({ itemCount, itemSize, height, width, style, onHScroll, children }, ref) {
    const containerRef = useRef<HTMLDivElement>(null)
    const [scrollTop, setScrollTop] = useState(0)

    useImperativeHandle(ref, () => ({
      scrollTo: (offset: number) => {
        containerRef.current?.scrollTo({ top: offset })
        setScrollTop(offset)
      }
    }))

    const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
      const el = e.target as HTMLDivElement
      setScrollTop(el.scrollTop)
      if (onHScroll) onHScroll(el.scrollLeft)
    }, [onHScroll])

    const totalHeight = itemCount * itemSize
    const overscan = 5
    const startIndex = Math.max(0, Math.floor(scrollTop / itemSize) - overscan)
    const visibleCount = Math.ceil(height / itemSize) + overscan * 2
    const endIndex = Math.min(itemCount - 1, startIndex + visibleCount)

    const items = []
    for (let i = startIndex; i <= endIndex; i++) {
      items.push(
        children({
          index: i,
          style: {
            position: 'absolute',
            top: i * itemSize,
            left: 0,
            width: '100%',
            height: itemSize,
          },
        })
      )
    }

    return (
      <div
        ref={containerRef}
        onScroll={onScroll}
        style={{
          height,
          width,
          overflowY: 'auto',
          overflowX: style?.minWidth ? 'auto' : 'visible',
          position: 'relative',
          ...style,
        }}
      >
        <div style={{ height: totalHeight, position: 'relative' }}>
          {items}
        </div>
      </div>
    )
  }
)
