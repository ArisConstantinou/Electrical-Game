/** Keyboard/touch/render tests must never capture the user's operating-system
 * cursor. Install before navigation, including in headless Chrome. This does
 * not simulate a lock or alter game controls; the browser rejects the request. */
export async function blockPointerLock(context) {
  await context.addInitScript(() => {
    Object.defineProperty(Element.prototype, 'requestPointerLock', {
      configurable: false, writable: false,
      value: () => Promise.reject(new DOMException('Pointer Lock disabled for automated verification', 'SecurityError')),
    });
  });
}
