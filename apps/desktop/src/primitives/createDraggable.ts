import { createSignal, onCleanup } from "solid-js";

export function createDraggable() {
  const [offset, setOffset] = createSignal<[number, number]>([0, 0]);
  const [isDragging, setIsDragging] = createSignal(false);

  let startX = 0;
  let startY = 0;
  let startOffsetX = 0;
  let startOffsetY = 0;

  const onPointerMove = (e: PointerEvent) => {
    const dx = startOffsetX + e.clientX - startX;
    const dy = startOffsetY + e.clientY - startY;
    setOffset([dx, dy]);
  };

  const onPointerUp = () => {
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    setIsDragging(false);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();

    const [ox, oy] = offset();
    startX = e.clientX;
    startY = e.clientY;
    startOffsetX = ox;
    startOffsetY = oy;

    setIsDragging(true);
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
  };

  const resetOffset = () => setOffset([0, 0]);

  onCleanup(() => {
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
  });

  return { offset, isDragging, onPointerDown, resetOffset };
}
