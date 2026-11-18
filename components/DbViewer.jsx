'use client';
import { useCallback, useEffect, useState } from 'react';

const PAGE = 100;
const SECRET = 'senha_hash';                 // editar = informar a nova senha (gravada com hash)
const READONLY = new Set(['token_hash']);   // hash de token que existe fora do banco

// Visualizador/editor do banco (somente master): lista as tabelas; clique em uma célula para editar, Enter salva
export default function DbViewer({ onClose }) {
  const [tables, setTables] = useState([]);
  const [cur, setCur] = useState(null);
  const [data, setData] = useState(null);
  const [offset, setOffset] = useState(0);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(null);      // { rowid, col, value, isNull }
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState(null);

  useEffect(() => {
    fetch('/api/admin/tables').then(r => (r.ok ? r.json() : Promise.reject(r.status))).then(setTables).catch(() => setErr('Não foi possível listar as tabelas'));
    const onKey = e => { if (e.key === 'Escape' && !document.activeElement?.closest?.('.dbv-edit')) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const load = useCallback(async (name, off) => {
    setErr('');
    const r = await fetch(`/api/admin/tables/${encodeURIComponent(name)}?limit=${PAGE}&offset=${off}`);
    if (!r.ok) return setErr('Não foi possível ler a tabela');
    setData(await r.json());
  }, []);

  const open = name => { setCur(name); setOffset(0); setData(null); setEdit(null); load(name, 0); };
  const go = off => { setOffset(off); setEdit(null); load(cur, off); };

  const startEdit = (row, col) => {
    if (READONLY.has(col)) return setErr('token_hash não pode ser editado');
    setErr('');
    const raw = row[col];
    setEdit({ rowid: row._rowid, col, isNull: raw === null, value: col === SECRET ? '' : raw === null ? '' : String(raw) });
  };

  const save = async () => {
    if (!edit || saving) return;
    setSaving(true); setErr('');
    const r = await fetch(`/api/admin/tables/${encodeURIComponent(cur)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowid: edit.rowid, column: edit.col, value: edit.isNull ? null : edit.value }),
    });
    const d = await r.json().catch(() => ({}));
    setSaving(false);
    if (!r.ok) return setErr(d.error || 'Não foi possível salvar');
    setData(cur0 => ({ ...cur0, rows: cur0.rows.map(x => (x._rowid === edit.rowid ? d.row : x)) }));
    setFlash(`${edit.rowid}:${edit.col}`); setTimeout(() => setFlash(null), 1200);
    setEdit(null);
  };

  const cell = v => (v === null ? <i className="dbv-null">NULL</i> : String(v));
  const metaOf = col => data?.meta?.find(m => m.name === col);

  return (
    <div className="dbv" role="dialog" aria-label="Banco de dados">
      <header className="dbv-h">
        <strong>Banco de dados</strong>
        {cur && data && <span className="dbv-sub">{cur} · {data.total} linha(s)</span>}
        <span className="dbv-note">Clique em uma célula para editar · Enter salva · Esc cancela · hashes ocultos</span>
        <button className="dbv-close" onClick={onClose}>Fechar ✕</button>
      </header>
      <div className="dbv-body">
        <nav className="dbv-tables">
          {tables.map(t => (
            <button key={t.name} className={t.name === cur ? 'on' : ''} onClick={() => open(t.name)}>
              <span>{t.name}</span><small>{t.rows}</small>
            </button>
          ))}
        </nav>
        <section className="dbv-main">
          {err && <p className="dbv-err">{err}</p>}
          {!cur && !err && <p className="dbv-empty">Clique em uma tabela para ver e editar os dados.</p>}
          {cur && !data && !err && <p className="dbv-empty">Carregando…</p>}
          {data && (
            <>
              <div className="dbv-scroll">
                <table>
                  <thead><tr>{data.columns.map(c => <th key={c} title={metaOf(c) ? `${metaOf(c).type || 'sem tipo'}${metaOf(c).pk ? ' · chave primária' : ''}${metaOf(c).notnull ? ' · obrigatório' : ''}` : ''}>{c}</th>)}</tr></thead>
                  <tbody>
                    {data.rows.map(r => (
                      <tr key={r._rowid}>
                        {data.columns.map(c => {
                          const editing = edit && edit.rowid === r._rowid && edit.col === c;
                          const m = metaOf(c);
                          const long = String(r[c] ?? '').length > 60 || String(r[c] ?? '').includes('\n');
                          return (
                            <td key={c} className={`${editing ? 'editing' : ''}${flash === `${r._rowid}:${c}` ? ' flash' : ''}${READONLY.has(c) ? ' ro' : ''}`}
                              title={editing ? '' : (r[c] == null ? '' : String(r[c]))} onClick={() => !editing && startEdit(r, c)}>
                              {editing ? (
                                <div className="dbv-edit">
                                  {long || edit.value.length > 60 ? (
                                    <textarea autoFocus rows={4} value={edit.isNull ? '' : edit.value} disabled={edit.isNull || saving}
                                      onChange={e => setEdit({ ...edit, value: e.target.value })}
                                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); } if (e.key === 'Escape') setEdit(null); }} />
                                  ) : (
                                    <input autoFocus type={c === SECRET ? 'password' : 'text'} value={edit.isNull ? '' : edit.value} disabled={edit.isNull || saving}
                                      placeholder={c === SECRET ? 'nova senha (será criptografada)' : edit.isNull ? 'NULL' : ''}
                                      onChange={e => setEdit({ ...edit, value: e.target.value })}
                                      onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEdit(null); }} />
                                  )}
                                  <span className="dbv-edit-actions">
                                    {m && !m.notnull && !m.pk && c !== SECRET && (
                                      <label title="Gravar NULL"><input type="checkbox" checked={edit.isNull} onChange={e => setEdit({ ...edit, isNull: e.target.checked })} /> NULL</label>
                                    )}
                                    <small className="dbv-hint">{saving ? 'salvando…' : 'Enter salva · Esc cancela'}</small>
                                  </span>
                                </div>
                              ) : cell(r[c])}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    {!data.rows.length && <tr><td colSpan={data.columns.length} className="dbv-empty">Tabela vazia</td></tr>}
                  </tbody>
                </table>
              </div>
              <footer className="dbv-pager">
                <button disabled={offset === 0} onClick={() => go(Math.max(0, offset - PAGE))}>← Anterior</button>
                <span>{data.total ? `${offset + 1}–${Math.min(offset + PAGE, data.total)} de ${data.total}` : '0'}</span>
                <button disabled={offset + PAGE >= data.total} onClick={() => go(offset + PAGE)}>Próxima →</button>
              </footer>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
