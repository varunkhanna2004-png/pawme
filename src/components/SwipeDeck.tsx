import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { DeckCard, Enums } from '../lib/supabase';
import PetCard from './PetCard';

type SwipeAction = Enums<'swipe_action'>;

export interface SwipeDeckHandle {
  /** Animate the top card out as if it had been swiped (used by the buttons). */
  swipe: (action: SwipeAction) => void;
}

interface Props {
  cards: DeckCard[];
  canSuper: boolean;
  onSwiped: (card: DeckCard, action: SwipeAction) => void;
  onSuperBlocked: () => void;
}

const SWIPE_X = 110; // px of travel that commits a like / pass
const SWIPE_UP = 120; // px of upward travel that commits a Super Paw
const FLICK = 0.55; // px/ms — a fast flick commits even if short
const haptic = (ms: number) => navigator.vibrate?.(ms);

/**
 * The Discover deck (§6). While a finger is down, NOTHING goes through React:
 * pointer moves write straight to element styles inside requestAnimationFrame,
 * touching only `transform` and `opacity` (compositor-only), which is what
 * keeps the drag at 60 fps on a mid-range phone.
 */
const SwipeDeck = forwardRef<SwipeDeckHandle, Props>(function SwipeDeck({ cards, canSuper, onSwiped, onSuperBlocked }, ref) {
  const top = cards[0];
  const topEl = useRef<HTMLDivElement>(null);
  const nextEl = useRef<HTMLDivElement>(null);
  const likeStamp = useRef<HTMLDivElement>(null);
  const nopeStamp = useRef<HTMLDivElement>(null);
  const superStamp = useRef<HTMLDivElement>(null);
  const drag = useRef({ active: false, id: -1, x0: 0, y0: 0, t0: 0, dx: 0, dy: 0, lastX: 0, lastT: 0, vx: 0, raf: 0, crossed: false, leaving: false });
  const [photoIndex, setPhotoIndex] = useState(0);

  // New top card → reset per-card state.
  useEffect(() => {
    setPhotoIndex(0);
    drag.current.leaving = false;
  }, [top?.pet_id]);

  const paint = useCallback(() => {
    const d = drag.current;
    d.raf = 0;
    const el = topEl.current;
    if (!el) return;
    el.style.transform = `translate3d(${d.dx}px, ${d.dy}px, 0) rotate(${d.dx * 0.06}deg)`;
    const upward = d.dy < 0 && Math.abs(d.dx) < 80;
    if (likeStamp.current) likeStamp.current.style.opacity = String(Math.min(Math.max(d.dx / SWIPE_X, 0), 1));
    if (nopeStamp.current) nopeStamp.current.style.opacity = String(Math.min(Math.max(-d.dx / SWIPE_X, 0), 1));
    if (superStamp.current) superStamp.current.style.opacity = String(upward ? Math.min(-d.dy / SWIPE_UP, 1) : 0);
    // The card underneath grows into place as the top one leaves.
    const progress = Math.min(Math.max(Math.abs(d.dx) / SWIPE_X, -d.dy / SWIPE_UP, 0), 1);
    if (nextEl.current) nextEl.current.style.transform = `scale(${0.95 + 0.05 * progress}) translateY(${10 - 10 * progress}px)`;
  }, []);

  const settle = useCallback(() => {
    const el = topEl.current;
    if (!el) return;
    el.style.transition = 'transform .35s cubic-bezier(.2,.9,.3,1.25)';
    drag.current.dx = 0;
    drag.current.dy = 0;
    paint();
  }, [paint]);

  const flyOut = useCallback(
    (action: SwipeAction) => {
      const d = drag.current;
      const el = topEl.current;
      if (!el || !top || d.leaving) return;
      if (action === 'super' && !canSuper) {
        settle();
        onSuperBlocked();
        return;
      }
      d.leaving = true;
      haptic(action === 'super' ? 25 : 12);
      const card = top;
      const x = action === 'like' ? window.innerWidth * 1.4 : action === 'pass' ? -window.innerWidth * 1.4 : 0;
      const y = action === 'super' ? -window.innerHeight * 1.2 : d.dy;
      el.style.transition = 'transform .3s ease-out';
      el.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${action === 'like' ? 28 : action === 'pass' ? -28 : 0}deg)`;
      const stamp = action === 'like' ? likeStamp : action === 'pass' ? nopeStamp : superStamp;
      if (stamp.current) stamp.current.style.opacity = '1';
      if (nextEl.current) {
        nextEl.current.style.transition = 'transform .3s ease-out';
        nextEl.current.style.transform = 'scale(1) translateY(0)';
      }
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        onSwiped(card, action);
      };
      el.addEventListener('transitionend', finish, { once: true });
      setTimeout(finish, 380); // transitionend is not guaranteed (tab hidden, reduced motion)
    },
    [top, canSuper, onSwiped, onSuperBlocked, settle],
  );

  useImperativeHandle(ref, () => ({ swipe: flyOut }), [flyOut]);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (d.leaving || d.active) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    Object.assign(d, { active: true, id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: e.timeStamp, dx: 0, dy: 0, lastX: e.clientX, lastT: e.timeStamp, vx: 0, crossed: false });
    e.currentTarget.style.transition = 'none';
    if (nextEl.current) nextEl.current.style.transition = 'none';
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d.active || e.pointerId !== d.id) return;
    d.dx = e.clientX - d.x0;
    d.dy = e.clientY - d.y0;
    const dt = e.timeStamp - d.lastT;
    if (dt > 0) d.vx = 0.7 * d.vx + 0.3 * ((e.clientX - d.lastX) / dt);
    d.lastX = e.clientX;
    d.lastT = e.timeStamp;
    const crossed = Math.abs(d.dx) > SWIPE_X || (d.dy < -SWIPE_UP && Math.abs(d.dx) < 80);
    if (crossed && !d.crossed) haptic(8);
    d.crossed = crossed;
    if (!d.raf) d.raf = requestAnimationFrame(paint);
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d.active || e.pointerId !== d.id) return;
    d.active = false;
    const moved = Math.hypot(d.dx, d.dy);
    if (moved < 8 && e.timeStamp - d.t0 < 350) {
      // A tap: left/right half of the photo steps through photos.
      const rect = e.currentTarget.getBoundingClientRect();
      const count = top?.photos.length ?? 0;
      if (count > 1) setPhotoIndex((i) => (e.clientX - rect.left > rect.width / 2 ? Math.min(i + 1, count - 1) : Math.max(i - 1, 0)));
      settle();
      return;
    }
    if (d.dy < -SWIPE_UP && Math.abs(d.dx) < 100) flyOut('super');
    else if (d.dx > SWIPE_X || d.vx > FLICK) flyOut('like');
    else if (d.dx < -SWIPE_X || d.vx < -FLICK) flyOut('pass');
    else settle();
  }

  if (!top) return null;
  const next = cards[1];
  const third = cards[2];

  return (
    <div className="relative h-full w-full select-none">
      {third && (
        <div key={third.pet_id} className="absolute inset-0" style={{ transform: 'scale(0.9) translateY(20px)' }}>
          <PetCard card={third} photoIndex={0} dimmed />
        </div>
      )}
      {next && (
        <div key={next.pet_id} ref={nextEl} className="absolute inset-0 will-change-transform" style={{ transform: 'scale(0.95) translateY(10px)' }}>
          <PetCard card={next} photoIndex={0} />
        </div>
      )}
      <div
        key={top.pet_id}
        ref={topEl}
        className="absolute inset-0 cursor-grab touch-none will-change-transform active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="group"
        aria-label={`${top.name}. Swipe right to like, left to pass, up for Super Paw.`}
      >
        <PetCard card={top} photoIndex={photoIndex} />
        <div ref={likeStamp} className="pointer-events-none absolute left-5 top-8 -rotate-12 rounded-xl border-4 border-like px-3 py-1 text-3xl font-extrabold text-like opacity-0">LIKE</div>
        <div ref={nopeStamp} className="pointer-events-none absolute right-5 top-8 rotate-12 rounded-xl border-4 border-nope px-3 py-1 text-3xl font-extrabold text-nope opacity-0">NOPE</div>
        <div ref={superStamp} className="pointer-events-none absolute inset-x-0 bottom-40 mx-auto w-fit -rotate-6 rounded-xl border-4 border-super bg-white/20 px-3 py-1 text-3xl font-extrabold text-super opacity-0">SUPER PAW</div>
      </div>
    </div>
  );
});

export default SwipeDeck;
