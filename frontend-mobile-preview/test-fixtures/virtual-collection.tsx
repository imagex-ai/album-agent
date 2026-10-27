// Development-only regression fixture; not an application route/build entry.
import React, { forwardRef, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { VirtualCollection } from '../src/components/common/VirtualCollection';

let nextInstance = 0;
type Item = { id: string };
const Card = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { item: Item }>(({ item, ...props }, ref) => {
  const [instance] = useState(() => ++nextInstance);
  return <div {...props} ref={ref} style={{ border: '1px solid #64748b', padding: 12, minHeight: 100 }}>
    <span>{item.id}</span>
    {item.id === 'item-12' && <video muted playsInline preload="none" data-player-instance={instance} style={{ width: 80, height: 40 }} />}
    <button type="button">Open {item.id}</button>
  </div>;
});
function Fixture() {
  const [items, setItems] = useState<Item[]>(() => Array.from({ length: 1000 }, (_, i) => ({ id: `item-${i}` })));
  const [columns, setColumns] = useState(2);
  const main = useRef<HTMLElement>(null);
  return <div style={{ '--columns': columns } as React.CSSProperties}>
    <style>{`body {font:16px sans-serif; margin:12px} button{margin:4px; padding:8px} .fixture-grid {display:grid;grid-template-columns:repeat(var(--columns),minmax(0,1fr));gap:20px} video {display:block;background:#000}`}</style>
    <h1>Collection regression fixture</h1>
    <button onClick={() => setItems(previous => [{ id: `new-${previous.length}` }, ...previous])}>Prepend item</button>
    <button onClick={() => setColumns(value => value === 2 ? 4 : 2)}>Toggle columns</button>
    <button onClick={() => { if (main.current) main.current.scrollTop = main.current.scrollHeight - 700; }}>Jump near end</button>
    <button onClick={() => { if (main.current) main.current.scrollTop = 0; }}>Return to start</button>
    <button onClick={() => { const targets = main.current?.querySelectorAll<HTMLButtonElement>('button'); targets?.[targets.length - 1]?.focus({ preventScroll: true }); }}>Focus window edge</button>
    <main ref={main} style={{ height: 600, overflowY: 'auto', border: '1px solid #64748b' }}>
      <VirtualCollection items={items} itemKey={item => item.id} columns={[[0, columns]]} className="fixture-grid" layoutKey="regression-fixture" gap={20} estimatedRowHeight={130} pinnedKeys={['item-12']}
        renderItem={item => <Card item={item} />} />
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
