import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Eye, Flag, Maximize2, Pause, Play, Radio, Shield, SkipBack, SkipForward, Star, Trophy } from 'lucide-react';
import { formatCoord, type GameState, type KnownCell, type Ship, type Side } from '../core';
import { buildReplayFrames, replayVisibleShips, type ReplayFrame } from '../core/replay';
import { SeaBoard } from '../scene/SeaBoard';
import { ShipIcon } from './Icons';
import './replay.css';

export interface ReplayViewProps {
  game: GameState;
  quality: 'low' | 'medium' | 'high';
  reducedMotion: boolean;
  onBack: () => void;
  favorite: boolean;
  onFavorite: () => void;
  saveStatus?: string;
  suspended?: boolean;
}

const SIDE: Record<Side, string> = { player: '我方', ai: '对手' };
const OUTCOME = { miss: '未命中', hit: '命中', sunk: '击沉' } as const;
const SYMBOL = { miss: '○', hit: '×', sunk: '◆' } as const;
const other = (side: Side): Side => side === 'player' ? 'ai' : 'player';

function describeFrame(frame: ReplayFrame): string {
  const event = frame.lastEvent;
  if (!event) return '开局，尚未发射炮弹';
  return `第 ${frame.index} 发，第 ${frame.round} 回合，${SIDE[event.attacker]}攻击 ${formatCoord(event.coord)}，${OUTCOME[event.result]}${event.sunkShip ? ` ${event.sunkShip.name}` : ''}`;
}

/** Only executed shots in the most recent visible volley, never its unused plan. */
function recentVolleyCells(frames: readonly ReplayFrame[], index: number, attacker: Side): number[] {
  let last = index;
  while (last > 0 && frames[last].lastEvent?.attacker !== attacker) last--;
  if (!last) return [];
  const volley = frames[last].volleyIndex;
  const cells: number[] = [];
  for (let i = last; i > 0 && frames[i].volleyIndex === volley; i--) {
    const event = frames[i].lastEvent;
    if (event?.attacker === attacker) cells.unshift(event.coord);
  }
  return cells;
}

function ReplayTacticalBoard({ ships, known, recent, label }: { ships: readonly Ship[]; known: readonly KnownCell[]; recent: readonly number[]; label: string }) {
  const fleetCells = new Set(ships.flatMap(ship => ship.cells));
  return <div className="replay-tactical-wrap">
    <div className="replay-grid-cols" aria-hidden="true"><span />{'ABCDEFGHIJ'.split('').map(letter => <span key={letter}>{letter}</span>)}</div>
    <div className="replay-grid-body">
      <div className="replay-grid-rows" aria-hidden="true">{Array.from({ length: 10 }, (_, row) => <span key={row}>{row + 1}</span>)}</div>
      <div className="replay-tactical-grid" role="grid" aria-readonly="true" aria-label={label}>
        {Array.from({ length: 10 }, (_, row) => <div role="row" className="replay-grid-row" key={row}>
          {Array.from({ length: 10 }, (_, col) => {
            const cell = row * 10 + col, value = known[cell], hasShip = fleetCells.has(cell);
            const description = value === 'unknown' ? hasShip ? '己方舰船，未受攻击' : '海面，未受攻击' : OUTCOME[value];
            return <span role="gridcell" key={cell} className={`replay-grid-cell ${value} ${hasShip ? 'has-ship' : ''} ${recent.includes(cell) ? 'recent' : ''}`} aria-label={`${formatCoord(cell)}，${description}`}>
              <span aria-hidden="true">{value === 'unknown' ? '' : SYMBOL[value]}</span>
            </span>;
          })}
        </div>)}
      </div>
    </div>
  </div>;
}

/** A completed match is validated once; playback never creates a live game. */
export function ReplayView(props: ReplayViewProps) {
  const replay = useMemo(() => {
    try {
      if (!props.game.winner) throw new Error('本局尚未结束。战斗结束后即可逐发回看。');
      return { frames: buildReplayFrames(props.game), error: '' };
    } catch (error) {
      return { frames: null, error: error instanceof Error ? error.message : '这份战斗记录暂时无法回放。' };
    }
  }, [props.game]);

  if (!replay.frames) return <main className="game-main replay-main replay-unavailable">
    <Shield size={34} aria-hidden="true" />
    <h1>暂时无法回放</h1>
    <p role="alert">{replay.error}</p>
    <button type="button" className="secondary-button" onClick={props.onBack}><ArrowLeft size={16} aria-hidden="true" /> 返回</button>
  </main>;

  return <ReplayPlayer key={props.game.matchId} {...props} frames={replay.frames} />;
}

function ReplayPlayer({ game, quality, reducedMotion, onBack, favorite, onFavorite, saveStatus, suspended = false, frames }: ReplayViewProps & { frames: readonly ReplayFrame[] }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [perspective, setPerspective] = useState<Side>('player');
  const [board, setBoard] = useState<'target' | 'own'>('target');
  const [camera, setCamera] = useState(0);
  const root = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const eventList = useRef<HTMLDivElement>(null);
  const currentRow = useRef<HTMLButtonElement>(null);
  const lastIndex = frames.length - 1;
  const frame = frames[Math.min(index, lastIndex)];
  const event = frame.lastEvent;
  const finished = frame.index === lastIndex;
  const ships = useMemo(() => replayVisibleShips(game, frame, perspective), [game, frame, perspective]);
  const enemy = other(perspective);
  const defender = board === 'target' ? enemy : perspective;
  const attacker = other(defender);
  const latestCells = recentVolleyCells(frames, frame.index, attacker);
  const homeRecent = recentVolleyCells(frames, frame.index, enemy);
  const homeSunk = new Set(frame.sunk[perspective].map(ship => ship.id));
  const ownShots = frame.events.filter(shot => shot.attacker === perspective);
  const ownHits = ownShots.filter(shot => shot.result !== 'miss').length;
  const progress = lastIndex ? frame.index / lastIndex * 100 : 0;

  const seek = (next: number) => {
    setPlaying(false);
    setIndex(Math.max(0, Math.min(lastIndex, next)));
  };
  const togglePlayback = () => {
    if (playing) setPlaying(false);
    else if (!document.hidden && !suspended) {
      if (finished) setIndex(0);
      setPlaying(true);
    }
  };
  const leave = () => { setPlaying(false); onBack(); };

  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);

  useEffect(() => {
    if (!playing) return;
    if (index >= lastIndex || document.hidden || suspended) { setPlaying(false); return; }
    const timeout = window.setTimeout(() => setIndex(current => Math.min(lastIndex, current + 1)), 1250 / speed);
    return () => window.clearTimeout(timeout);
  }, [playing, index, lastIndex, speed, suspended]);

  useEffect(() => {
    const pauseWhenHidden = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener('visibilitychange', pauseWhenHidden);
    return () => document.removeEventListener('visibilitychange', pauseWhenHidden);
  }, []);

  useEffect(() => {
    const current = currentRow.current, list = eventList.current;
    if (!current || !list) return;
    const rowBounds = current.getBoundingClientRect(), listBounds = list.getBoundingClientRect();
    // Scroll only the event rail, without pulling the reader away from the board.
    if (rowBounds.top < listBounds.top) list.scrollTop -= listBounds.top - rowBounds.top;
    else if (rowBounds.bottom > listBounds.bottom) list.scrollTop += rowBounds.bottom - listBounds.bottom;
  }, [frame.index]);

  return <main ref={root} className="game-main replay-main" aria-label="战斗回放" onKeyDown={key => {
    const target = key.target as HTMLElement;
    if (target.closest('button,input,select,textarea,a,[contenteditable="true"]')) return;
    if (key.key === 'ArrowLeft') { key.preventDefault(); seek(index - 1); }
    else if (key.key === 'ArrowRight') { key.preventDefault(); seek(index + 1); }
    else if (key.key === 'Home') { key.preventDefault(); seek(0); }
    else if (key.key === 'End') { key.preventDefault(); seek(lastIndex); }
    else if (key.key === ' ') { key.preventDefault(); togglePlayback(); }
  }}>
    <section className="replay-heading">
      <div>
        <button type="button" className="back-link" onClick={leave}><ArrowLeft size={15} aria-hidden="true" /> 返回</button>
        <div className="replay-title-line"><h1 ref={heading} tabIndex={-1}>战斗回放<span>。</span></h1><span className="replay-readonly"><Eye size={12} aria-hidden="true" /> 只读回放</span></div>
        <p>沿着每一发炮弹，回到当时的海域。</p>
      </div>
      <div className="replay-match-summary">
        <span className={`replay-match-result ${game.winner === 'player' ? 'won' : ''}`}>{game.winner === 'player' ? <Trophy size={16} aria-hidden="true" /> : <Flag size={16} aria-hidden="true" />}{game.winner === 'player' ? '我方胜利' : '对手胜利'}</span>
        <span>{game.difficulty === 'normal' ? '普通难度' : '简单难度'} · 每回合 {game.rules.shellsPerTurn} 发</span>
        <span>{game.rules.placement === 'classic' ? '经典规则' : '旧局相邻规则'} · 共 {lastIndex} 发实射</span>
      </div>
      <div className="replay-save-area">
        <button type="button" className={`secondary-button replay-favorite ${favorite ? 'is-favorite' : ''}`} aria-pressed={favorite} aria-label={favorite ? '取消收藏本局' : '收藏本局'} onClick={onFavorite}><Star size={16} fill={favorite ? 'currentColor' : 'none'} aria-hidden="true" />{favorite ? '已收藏' : '收藏本局'}</button>
        {saveStatus && <span className="replay-save-status" role="status">{saveStatus}</span>}
      </div>
    </section>

    <section className="replay-perspective-bar" aria-label="回放视角">
      <div className="replay-perspective-buttons" role="group" aria-label="选择指挥官视角">
        {(['player', 'ai'] as const).map(side => <button type="button" key={side} className={perspective === side ? 'active' : ''} aria-pressed={perspective === side} onClick={() => { setPlaying(false); setPerspective(side); }}><Eye size={14} aria-hidden="true" />{SIDE[side]}视角{perspective === side && <Check size={12} aria-hidden="true" />}</button>)}
      </div>
      <p><Shield size={13} aria-hidden="true" /> 敌舰仅在当时被击沉后显现</p>
    </section>

    <div className="replay-workspace">
      <section className="replay-viewer" aria-label="海域与播放控制">
        <div className="ocean-panel replay-ocean">
          <div className="ocean-topline">
            <div className="board-tabs" role="group" aria-label="选择回放海域">
              <button type="button" className={board === 'target' ? 'active' : ''} aria-pressed={board === 'target'} onClick={() => { setPlaying(false); setBoard('target'); }}>攻击海域 <span>TARGET WATERS</span></button>
              <button type="button" className={board === 'own' ? 'active' : ''} aria-pressed={board === 'own'} onClick={() => { setPlaying(false); setBoard('own'); }}>己方海域</button>
            </div>
            <span className="replay-sea-owner">{SIDE[defender]}舰队</span>
          </div>
          <div className="replay-scene" tabIndex={0} role="group" aria-label={`${SIDE[defender]}海域，只读。拖动旋转镜头；左右方向键逐发回看，空格播放或暂停。`}>
            <SeaBoard ships={ships[defender]} known={frame.known[attacker]} latestVolleyCells={latestCells} interactive={false} quality={quality} reducedMotion={reducedMotion} resetKey={camera} />
          </div>
          <div className="ocean-bottomline">
            <span><span className="replay-marker-key" aria-hidden="true" /> 方框标记最近一轮已发射炮弹</span>
            <button type="button" className="icon-button" aria-label="重置回放镜头" title="重置镜头" onClick={() => setCamera(value => value + 1)}><Maximize2 size={16} aria-hidden="true" /></button>
          </div>
        </div>

        <section className="replay-transport" aria-label="回放时间轴">
          <div className="replay-timeline-caption"><label htmlFor="replay-progress">{frame.index === 0 ? '开局部署' : finished ? '战斗结束' : `第 ${frame.round} 回合`}<span>{frame.index === 0 ? '一切尚未发生' : `${SIDE[event!.attacker]} · 本轮第 ${frame.shotInVolley} / ${frame.plannedShots} 发`}</span></label><span className="replay-shot-count"><strong>{String(frame.index).padStart(2, '0')}</strong> / {String(lastIndex).padStart(2, '0')} <small>发</small></span></div>
          <div className="replay-range-wrap" style={{ '--replay-progress': `${progress}%` } as CSSProperties}>
            <input id="replay-progress" type="range" aria-label="回放进度" aria-valuetext={`${describeFrame(frame)}，共 ${lastIndex} 发`} min={0} max={lastIndex} step={1} value={frame.index} onPointerDown={() => setPlaying(false)} onKeyDown={() => setPlaying(false)} onChange={change => seek(Number(change.target.value))} />
            <div className="replay-sink-markers" aria-hidden="true">{frames.filter(step => step.lastEvent?.result === 'sunk').map(step => <i key={step.index} className={step.index <= frame.index ? 'passed' : ''} style={{ left: `${step.index / lastIndex * 100}%` }} />)}</div>
          </div>
          <div className="replay-playback-row">
            <div className="replay-playback-buttons" role="group" aria-label="逐发播放控制">
              <button type="button" className="icon-button" aria-label="跳到开局" title="跳到开局" disabled={frame.index === 0} onClick={() => seek(0)}><SkipBack size={17} aria-hidden="true" /></button>
              <button type="button" className="icon-button" aria-label="上一发" title="上一发（←）" disabled={frame.index === 0} onClick={() => seek(index - 1)}><ChevronLeft size={21} aria-hidden="true" /></button>
              <button type="button" className={`replay-play-button ${playing ? 'playing' : ''}`} aria-label={playing ? '暂停回放' : finished ? '重新播放' : '自动播放'} onClick={togglePlayback}>{playing ? <Pause size={17} fill="currentColor" aria-hidden="true" /> : <Play size={17} fill="currentColor" aria-hidden="true" />}<span>{playing ? '暂停' : finished ? '重新播放' : '自动播放'}</span></button>
              <button type="button" className="icon-button" aria-label="下一发" title="下一发（→）" disabled={finished} onClick={() => seek(index + 1)}><ChevronRight size={21} aria-hidden="true" /></button>
              <button type="button" className="icon-button" aria-label="跳到结局" title="跳到结局" disabled={finished} onClick={() => seek(lastIndex)}><SkipForward size={17} aria-hidden="true" /></button>
            </div>
            <label className="replay-speed">播放速度<select aria-label="回放速度" value={speed} onChange={change => setSpeed(Number(change.target.value))}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></label>
          </div>
          <p className="replay-keyboard-hint">左右方向键逐发回看 <span>·</span> 空格播放 / 暂停 <span>·</span> ◆ 击沉时刻</p>
        </section>
      </section>

      <aside className="replay-sidebar">
        <section className={`panel replay-current-shot ${event?.result ?? 'opening'}`} aria-label="当前炮击详情">
          <div className="replay-panel-heading"><h2>{event ? '这一发' : '战斗开始前'}</h2><span>{event ? `SHOT ${String(frame.index).padStart(3, '0')}` : 'DEPLOYMENT'}</span></div>
          <div className="replay-shot-focus">{event ? <><span className="replay-coordinate">{formatCoord(event.coord)}</span><div><span className="replay-shot-side">{SIDE[event.attacker]} → {SIDE[other(event.attacker)]}</span><strong className="replay-outcome"><span aria-hidden="true">{SYMBOL[event.result]}</span> {OUTCOME[event.result]}</strong></div></> : <><Radio size={35} strokeWidth={1.3} aria-hidden="true" /><div><strong>海域静默</strong><span className="replay-shot-side">等待第一声炮响</span></div></>}</div>
          <dl className="replay-shot-details"><div><dt>回合</dt><dd>{event ? String(frame.round).padStart(2, '0') : '—'}</dd></div><div><dt>齐射序号</dt><dd>{event ? String(frame.volleyIndex + 1).padStart(2, '0') : '—'}</dd></div><div><dt>轮内炮弹</dt><dd>{event ? `${frame.shotInVolley} / ${frame.plannedShots}` : '—'}</dd></div></dl>
          <p className="replay-event-note">{event?.winner ? `${SIDE[event.winner]}获胜。${frame.shotInVolley < frame.plannedShots ? '本轮剩余炮弹未发射。' : '最后一艘敌舰沉没。'}` : event?.sunkShip ? `${event.sunkShip.name}被击沉，${event.sunkShip.length} 格舰体现已公开。` : event?.result === 'hit' ? '发现舰体，舰种与完整位置仍未公开。' : event?.result === 'miss' ? '这一格已排除，继续寻找未知海域。' : '从开局开始，或拖动时间轴跳转。'}</p>
          <span className="replay-sr-only" role="status" aria-live="polite" aria-atomic="true">{playing ? '' : describeFrame(frame)}</span>
        </section>

        <section className="panel replay-own-fleet" aria-label={`${SIDE[perspective]}舰队当前状态`}>
          <div className="replay-panel-heading"><h2>{SIDE[perspective]}舰队</h2><span>{5 - homeSunk.size} / 5 在航</span></div>
          <ReplayTacticalBoard ships={ships[perspective]} known={frame.known[enemy]} recent={homeRecent} label={`${SIDE[perspective]}舰队布局，第 ${frame.index} 发之后`} />
          <div className="replay-fleet-list">{ships[perspective].map(ship => <div key={ship.id} className={homeSunk.has(ship.id) ? 'is-sunk' : ''}><ShipIcon length={ship.length} /><span>{ship.name}</span><span className="replay-health-pips" aria-label={`${ship.name}，剩余 ${ship.cells.filter(cell => !frame.shots[enemy].includes(cell)).length} 格舰体`}>{ship.cells.map(cell => <i key={cell} className={frame.shots[enemy].includes(cell) ? 'damaged' : ''} />)}</span></div>)}</div>
          <div className="replay-fleet-totals"><span>已发射 <strong>{ownShots.length}</strong></span><span>命中 <strong>{ownHits}</strong></span><span>击沉敌舰 <strong>{frame.sunk[enemy].length}</strong></span></div>
        </section>
      </aside>
    </div>

    <section className="panel replay-event-log" aria-labelledby="replay-events-heading">
      <div className="replay-panel-heading"><div><h2 id="replay-events-heading">逐发记录</h2><p>点击任意一发，查看当时的海域</p></div><span>{frame.index} / {lastIndex} 已回看</span></div>
      <div className="replay-event-columns" aria-hidden="true"><span>发次 / 回合</span><span>攻击方</span><span>坐标</span><span>结果</span><span>轮内炮弹</span></div>
      <div ref={eventList} className="replay-event-list" role="list" aria-label="全部实际炮击记录">
        <div role="listitem"><button ref={frame.index === 0 ? currentRow : undefined} type="button" className={`replay-event-row replay-opening-row ${frame.index === 0 ? 'current' : 'past'}`} aria-current={frame.index === 0 ? 'step' : undefined} aria-label="跳转到开局部署" onClick={() => seek(0)}><span className="replay-log-number">00 <small>开局</small></span><span className="replay-opening-copy"><Radio size={13} aria-hidden="true" /> 双方舰队就位，尚未发射炮弹</span><ChevronRight size={14} aria-hidden="true" /></button></div>
        {frames.slice(1).map(step => {
          const shot = step.lastEvent!;
          return <div role="listitem" key={shot.id}><button ref={frame.index === step.index ? currentRow : undefined} type="button" className={`replay-event-row ${shot.result} ${frame.index === step.index ? 'current' : frame.index > step.index ? 'past' : 'future'}`} aria-current={frame.index === step.index ? 'step' : undefined} aria-label={`跳转到${describeFrame(step)}`} onClick={() => seek(step.index)}>
            <span className="replay-log-number">{String(step.index).padStart(2, '0')}<small>R{String(step.round).padStart(2, '0')}</small></span>
            <span className={`replay-log-side ${shot.attacker}`}><i aria-hidden="true" />{SIDE[shot.attacker]}</span>
            <strong className="replay-log-coordinate">{formatCoord(shot.coord)}</strong>
            <span className="replay-log-result"><b aria-hidden="true">{SYMBOL[shot.result]}</b>{OUTCOME[shot.result]}{shot.sunkShip && <small> · {shot.sunkShip.name}</small>}{shot.winner && <Trophy size={12} aria-label="获胜一击" />}</span>
            <span className="replay-log-volley">{step.shotInVolley} / {step.plannedShots}<ChevronRight size={14} aria-hidden="true" /></span>
          </button></div>;
        })}
      </div>
    </section>
    <p className="replay-bottom-note"><Shield size={12} aria-hidden="true" /> 回放只展示实际发生的炮击，不会改变进行中的战斗。</p>
  </main>;
}

export default ReplayView;
