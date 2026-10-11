/** Map a client pointer position into an element's local pixel space (handles CSS scale). */
export function clientPointInElement(element, clientX, clientY) {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
        return { x: 0, y: 0 };
    }
    const canvas = element instanceof HTMLCanvasElement
        ? element
        : element.querySelector('canvas');
    if (canvas instanceof HTMLCanvasElement && canvas.width > 0 && canvas.height > 0) {
        return {
            x: (clientX - rect.left) * (canvas.width / rect.width),
            y: (clientY - rect.top) * (canvas.height / rect.height),
        };
    }
    return {
        x: clientX - rect.left,
        y: clientY - rect.top,
    };
}
