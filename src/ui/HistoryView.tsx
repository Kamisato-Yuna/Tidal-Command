import { useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Download, FileUp, Heart, Shield, Trophy, Flag, Clock3, RefreshCw, AlertTriangle } from 'lucide-react';
import { getRoundNumber } from '../core';
import { MAX_BACKUP_BYTES, type MatchRecord } from '../core/history';
import './history.css';

interface Props {
  records: MatchRecord[]; pending: MatchRecord[]; error: string; message: string;
  onBack: () => void; onReplay: (record: MatchRecord) => void;
  onFavorite: (record: MatchRecord) => void; onRetry: () => void;
  onImport: (raw: string) => boolean; onExport: (record?: MatchRecord) => string;
}

export function downloadMatchBackup(raw: string, name = 'tidal-command-history') {
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url;
  link.download = `${name}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function dateLabel(time: number) {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', year: 'numeric' }).format(new Date(time));
}

export function HistoryView({ records, pending, error, message, onBack, onReplay, onFavorite, onRetry, onImport, onExport }: Props) {
  const [favoritesOnly, setFavoritesOnly] = useState(false), [page, setPage] = useState(0);
  const [fileError, setFileError] = useState(''), [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const all = useMemo(() => [
    ...pending.map(record => ({ record, pending: true })),
    ...records.map(record => ({ record, pending: false })),
  ].sort((a, b) => b.record.completedAt - a.record.completedAt), [records, pending]);
  const filtered = favoritesOnly ? all.filter(item => item.record.favorite) : all;
  const lastPage = Math.max(0, Math.ceil(filtered.length / 12) - 1), currentPage = Math.min(page, lastPage);
  const items = filtered.slice(currentPage * 12, currentPage * 12 + 12);
  const exportFile = (record?: MatchRecord) => {
    try { downloadMatchBackup(onExport(record), record ? 'tidal-command-match' : undefined); setFileError(''); }
    catch (err) { setFileError(err instanceof Error ? err.message : '备份导出失败，请重试。'); }
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    setBusy(true); setFileError('');
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('备份超过20MB，请选择较小的对战备份。');
      onImport(await file.text());
    } catch (err) { setFileError(err instanceof Error ? err.message : '无法读取备份文件。'); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  return <main className="game-main history-main">
    <section className="history-heading">
      <div><button className="back-link" onClick={onBack}><ArrowLeft size={15}/> 返回首页</button><span className="eyebrow">CAPTAIN’S ARCHIVE</span><h1>每一场海战，<span>都有回声。</span></h1><p>回到关键的一击，重新读懂你的每一次选择。</p></div>
      <div className="history-total"><BookOpen size={24}/><strong>{records.length}</strong><span>已保存对局</span></div>
    </section>
    <section className="history-policy panel"><Shield size={20}/><div><strong>最近50场未收藏对局 · 收藏不会自动清理</strong><p>记录仅保存在当前浏览器。清除网站数据、浏览器重置或更换设备都可能使记录丢失；收藏也不能避免这些情况。请定期导出备份，在其他设备导入恢复。旧对局的时间为首次归档时间。</p></div></section>
    <div className="history-toolbar">
      <div className="segmented" aria-label="对战记录筛选"><button className={!favoritesOnly?'active':''} aria-pressed={!favoritesOnly} onClick={()=>{setFavoritesOnly(false);setPage(0);}}>全部记录 <span>{all.length}</span></button><button className={favoritesOnly?'active':''} aria-pressed={favoritesOnly} onClick={()=>{setFavoritesOnly(true);setPage(0);}}><Heart size={14}/> 已收藏 <span>{records.filter(record=>record.favorite).length}</span></button></div>
      <div className="history-backups"><button className="secondary-button" disabled={busy} onClick={()=>input.current?.click()}><FileUp size={16}/>{busy?'正在验证备份…':'导入备份'}</button><button className="secondary-button" disabled={!all.length} onClick={()=>exportFile()}><Download size={16}/> 导出全部备份</button><input ref={input} type="file" accept="application/json,.json" aria-label="导入对战备份文件" className="history-file-input" onChange={event=>void importFile(event.target.files?.[0])}/></div>
    </div>
    {(error||fileError)&&<div className="history-alert error" role="alert"><AlertTriangle size={18}/><div><strong>记录尚未安全保存</strong><p>{fileError||error}</p><p>已保存内容不会被清空。请导出可读记录，并在浏览器存储恢复后重试。</p></div><button onClick={onRetry}><RefreshCw size={15}/> 重试</button></div>}
    {!!pending.length&&<div className="history-alert" role="status"><AlertTriangle size={18}/><div><strong>{pending.length} 场对局仅暂存在当前页面</strong><p>关闭或刷新可能丢失这些记录。请先导出备份，或重试保存。</p></div><button onClick={onRetry}><RefreshCw size={15}/> 重试保存</button></div>}
    {message&&<p className="history-message" role="status">{message}</p>}
    <section className="history-list" aria-label="已完成对战记录">
      {items.length?items.map(({record,pending:unsaved})=>{
        const game=record.game, shots=game.events.filter(event=>event.attacker==='player'), hits=shots.filter(event=>event.result!=='miss').length;
        return <article key={`${unsaved?'pending':'saved'}:${record.id}`} className={`history-card panel ${record.favorite?'favorite':''}`}>
          <div className="history-card-top"><span className={`history-result ${game.winner==='player'?'won':''}`}>{game.winner==='player'?<Trophy size={19}/>:<Flag size={19}/>} {game.winner==='player'?'胜利':'落败'}</span><button className={`history-favorite ${record.favorite?'active':''}`} aria-label={record.favorite?'取消收藏对局':'收藏对局'} aria-pressed={record.favorite} onClick={()=>onFavorite(record)} title={record.favorite?'取消收藏后按近期记录保留':'收藏后不会自动清理'}><Heart size={18} fill={record.favorite?'currentColor':'none'}/><span>{record.favorite?'已收藏':'收藏'}</span></button></div>
          <time dateTime={new Date(record.completedAt).toISOString()}><Clock3 size={12}/>{dateLabel(record.completedAt)}</time>
          <h2>{game.difficulty==='normal'?'普通 · 高强度对手':'简单 · 从容起航'}</h2><p className="history-match-meta">每回合 {game.rules.shellsPerTurn} 发 <i/> {game.rules.placement==='classic'?'经典规则':'旧局相邻规则'}</p>
          <div className="history-card-stats"><span><strong>{getRoundNumber(game)}</strong> 回合</span><span><strong>{shots.length}</strong> 次攻击</span><span><strong>{shots.length?Math.round(hits/shots.length*100):0}%</strong> 命中</span></div>
          {unsaved&&<p className="history-unsaved">尚未写入浏览器存储</p>}
          <div className="history-card-actions"><button className="history-replay" onClick={()=>onReplay(record)}><BookOpen size={15}/> 复盘对局 <ArrowRight size={15}/></button><button className="icon-button" aria-label="导出这场对局" title="导出这场对局" onClick={()=>exportFile(record)}><Download size={17}/></button></div>
        </article>;
      }):<div className="history-empty"><BookOpen size={40} strokeWidth={1}/><h2>{favoritesOnly?'珍藏值得回看的海战。':'你的航海日志，从第一战开始。'}</h2><p>{favoritesOnly?'点击对局上的爱心，即可收藏。':'完成对战后自动归档，也可以导入已有备份。'}</p><button className="secondary-button" onClick={onBack}>返回首页 <ArrowRight size={15}/></button></div>}
    </section>
    {lastPage>0&&<nav className="history-pagination" aria-label="对战记录分页"><button disabled={!currentPage} onClick={()=>setPage(currentPage-1)}><ArrowLeft size={15}/> 上一页</button><span>{currentPage+1} / {lastPage+1}</span><button disabled={currentPage===lastPage} onClick={()=>setPage(currentPage+1)}>下一页 <ArrowRight size={15}/></button></nav>}
  </main>;
}
