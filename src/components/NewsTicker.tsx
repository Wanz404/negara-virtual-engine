import { WORLD } from '../configs';
import { INAUGURATION_ENABLED, INAUGURATION_TICKER } from '../lib/inauguration';
import type { NewsItem, WorldState } from '../services';

const ICON: Record<string, string> = {
  join: '🆕',
  status: '💬',
  property: '🏗️',
  project: '🚧',
  decree: '📢',
  impeachment: '🚨',
  verification: '✅',
  expansion: '🗺️',
  poll: '🗳️',
  system: 'ℹ️',
};

/** Running text "Breaking News" ala TV di atas layar. */
export function NewsTicker({ news, world }: { news: NewsItem[]; world: WorldState | null }) {
  const items = news.slice(0, 15);
  const pinned = world?.presidentAnnouncement;
  const feed =
    items.length > 0 ? items.map((n) => `${ICON[n.category] ?? '•'} ${n.message}`).join('     •     ') : `Selamat datang di ${WORLD.copy.nationName}! ${WORLD.copy.tagline}`;
  const text = INAUGURATION_ENABLED ? `🎖️ ${INAUGURATION_TICKER}     •     ${feed}` : feed;

  return (
    <div className="flex h-9 items-stretch overflow-hidden bg-gray-950 text-white shadow-md">
      <div className="z-10 flex shrink-0 items-center gap-1.5 bg-brand px-3 text-[11px] font-black tracking-wider uppercase">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
        {WORLD.copy.tvName}
      </div>
      {pinned && (
        <div className="z-10 hidden max-w-[40%] shrink-0 items-center truncate bg-accent px-3 text-[11px] font-bold text-gray-900 sm:flex">📌 {pinned}</div>
      )}
      <div className="relative flex-1 overflow-hidden">
        <div className="animate-ticker absolute top-0 flex h-full items-center whitespace-nowrap text-[12px] font-medium">
          <span className="px-6">{pinned ? `📌 PIDATO: ${pinned}     •     ${text}` : text}</span>
          <span className="px-6" aria-hidden="true">
            {pinned ? `📌 PIDATO: ${pinned}     •     ${text}` : text}
          </span>
        </div>
      </div>
    </div>
  );
}
