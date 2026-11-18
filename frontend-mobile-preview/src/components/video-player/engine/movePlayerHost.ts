/** Move a persistent player host within one document without replacing it. */
export function movePlayerHost(host: HTMLElement, target: HTMLElement): boolean {
  if (host.ownerDocument !== target.ownerDocument || host === target || host.contains(target)) return false;
  if (host.parentElement === target) return true;

  const movable = target as HTMLElement & { moveBefore?: (node: Node, child: Node | null) => void };
  if (host.isConnected && target.isConnected && typeof movable.moveBefore === 'function') {
    try {
      movable.moveBefore(host, null);
      return host.parentElement === target;
    } catch {
      // A browser can expose the API but reject a particular move.
    }
  }
  try {
    target.appendChild(host);
    return host.parentElement === target;
  } catch {
    return false;
  }
}
