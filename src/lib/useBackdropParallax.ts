import { useEffect, type RefObject } from 'react'

/**
 * The tea shop's pointer parallax: the backdrop photo leans away from the
 * pointer through --px / --py (-0.5..0.5). One style write per frame at most.
 * Off under reduced motion and on touch screens.
 */
export function useBackdropParallax(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    const fine = matchMedia('(pointer: fine)')
    let frame = 0
    let px = 0
    let py = 0
    const apply = () => {
      frame = 0
      const style = ref.current?.style
      style?.setProperty('--px', px.toFixed(3))
      style?.setProperty('--py', py.toFixed(3))
    }
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || reduced.matches || !fine.matches) return
      px = event.clientX / window.innerWidth - 0.5
      py = event.clientY / window.innerHeight - 0.5
      if (!frame) frame = window.requestAnimationFrame(apply)
    }
    const settle = () => {
      if (!reduced.matches && fine.matches) return
      window.cancelAnimationFrame(frame)
      frame = 0
      ref.current?.style.removeProperty('--px')
      ref.current?.style.removeProperty('--py')
    }
    window.addEventListener('pointermove', move, { passive: true })
    reduced.addEventListener('change', settle)
    fine.addEventListener('change', settle)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', move)
      reduced.removeEventListener('change', settle)
      fine.removeEventListener('change', settle)
    }
  }, [ref])
}
