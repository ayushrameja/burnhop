import { ARENAS, getArena, type ArenaDefinition, type ArenaId } from './game/arenas';
import './ArenaSelector.css';

function ArenaPreview({ arena }: { arena: ArenaDefinition }) {
  return <span className={`arena-preview arena-preview-${arena.id}`} aria-hidden="true">
    {arena.preview ? <img src={arena.preview} alt="" /> : <svg viewBox="0 0 360 142" fill="none">
      <path d="M0 115h360v27H0z" fill="#343c38" /><path d="M0 115h360" stroke="#b0b19a" strokeWidth="2" />
      <path d="M16 81h45v6H16zM85 51h53v6H85zM175 81h49v6h-49zM259 38h56v7h-56z" fill="#879185" />
      <path d="M51 111V93M137 48V30M240 111V93" stroke="#626e64" />
      <path d="M52 107Q74 30 116 38T194 67T280 22" stroke="#b9bead" strokeOpacity=".45" strokeDasharray="3 5" />
      <circle cx="59" cy="108" r="3" fill="#dadaad" /><circle cx="140" cy="108" r="3" fill="#df7664" />
    </svg>}
  </span>;
}

export default function ArenaSelector({ selected, onChange }: { selected: ArenaId; onChange: (id: ArenaId) => void }) {
  const arena = getArena(selected);
  return <aside className="arena-selector" aria-label="Choose arena">
    <fieldset className="arena-options">
      <legend>CHOOSE YOUR ARENA</legend>
      <div className="arena-cards">{ARENAS.map(option => <label key={option.id} className="arena-option">
        <input type="radio" name="arena" value={option.id} aria-label={option.name} checked={selected === option.id} onChange={() => onChange(option.id)} />
        <span className="arena-card">
          <ArenaPreview arena={option} />
          <span className="arena-card-copy"><strong>{option.name}</strong><span>{option.id === 'range' ? 'Aim & movement' : 'Islands & tunnels'}</span></span>
          <span className="arena-selected" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none"><path d="m3 8 3 3 7-7" stroke="currentColor" strokeWidth="2" /></svg>SELECTED</span>
        </span>
      </label>)}</div>
    </fieldset>
    <p className="arena-details" id="arena-selection-summary" aria-live="polite"><strong>{arena.name}</strong><span>{arena.id === 'range' ? 'Practice your aim. Master your jetpack.' : 'Explore the islands. Find your route.'}</span></p>
  </aside>;
}
