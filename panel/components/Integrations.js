'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useOrg } from '@/lib/org-context';
import { dateTime, INTEGRATION_STATE_LABEL, CONNECTOR_STATUS_LABEL, errorText } from '@/lib/format';

// Uzak bir sisteme bağlanmayan, bizim tarafımızda çalışan bağlayıcılar: test hemen başarılı olur.
const LOCAL_CONNECTORS = ['csv_upload', 'app_barcode'];

const CAPABILITY_LABEL = {
  send_basket: 'Sepeti kasaya gönderir',
  read_sales: 'Satışları okur',
  read_stock: 'Stoğu okur',
  read_catalog: 'Ürün listesini okur',
  read_prices: 'Fiyatları okur',
  push_order: 'Siparişi programa aktarır',
  read_delivery: 'İrsaliyeyi okur',
};

function stateBadge(state) {
  const cls = state === 'active' ? 'ok' : state === 'error' ? 'warn' : state === 'draft' || state === 'testing' ? 'info' : '';
  return <span className={`badge ${cls}`}>{INTEGRATION_STATE_LABEL[state] || state}</span>;
}

// side: 'distributor' | 'retailer' — katalog buna göre süzülür.
export default function Integrations({ side = 'distributor' }) {
  const { org, user } = useOrg();
  const isRetailer = side === 'retailer';
  const [connectors, setConnectors] = useState([]);
  const [integrations, setIntegrations] = useState(null);
  const [message, setMessage] = useState(null);

  // Sihirbaz: { replacing: integration | null, step: 1 | 2, code, label, config }
  const [wizard, setWizard] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [c, i] = await Promise.all([
      supabase.from('connectors').select('*').eq(isRetailer ? 'for_retailer' : 'for_distributor', true).order('sort_order'),
      supabase.from('org_integrations').select('*').eq('org_id', org.id).order('created_at', { ascending: false }),
    ]);
    if (c.error || i.error) {
      setMessage({ kind: 'error', text: errorText(c.error || i.error) });
    }
    setConnectors(c.data || []);
    setIntegrations(i.data || []);
  }, [org.id, isRetailer]);

  useEffect(() => {
    load();
  }, [load]);

  const byCode = useMemo(() => new Map(connectors.map((c) => [c.code, c])), [connectors]);
  const current = (integrations || []).filter((i) => !['replaced', 'disabled'].includes(i.state));
  const history = (integrations || []).filter((i) => ['replaced', 'disabled'].includes(i.state));

  function openWizard(replacing) {
    setMessage(null);
    setWizard({ replacing: replacing || null, step: 1, code: null, label: replacing ? replacing.label || '' : '', config: {} });
  }

  async function runTest(integration) {
    const connector = byCode.get(integration.connector_code);
    const now = new Date().toISOString();
    const local = LOCAL_CONNECTORS.includes(integration.connector_code);
    const ok = local;
    const detail = local
      ? { note: 'Yerel bağlayıcı, uzak sisteme bağlantı gerekmez.' }
      : { note: `${connector ? connector.name : integration.connector_code} bağlantısı henüz hazır değil.` };

    await supabase.from('integration_events').insert({ integration_id: integration.id, kind: 'test', ok, detail });

    // Markette stok bilgisi tek bir kaynaktan gelir: çalışan yeni sistem ana kaynak olur.
    const capabilities = (connector && connector.capabilities) || [];
    const makePrimary = isRetailer && ok && capabilities.includes('read_stock');
    if (makePrimary) {
      await supabase
        .from('org_integrations')
        .update({ is_primary_stock_source: false })
        .eq('org_id', org.id)
        .neq('id', integration.id);
    }

    const { error } = await supabase
      .from('org_integrations')
      .update({
        last_test_at: now,
        last_test_ok: ok,
        last_error: ok ? null : detail.note,
        state: ok ? 'active' : 'error',
        ...(makePrimary ? { is_primary_stock_source: true } : {}),
        updated_at: now,
      })
      .eq('id', integration.id);
    if (error) {
      setMessage({ kind: 'error', text: errorText(error) });
    } else {
      setMessage(ok
        ? { kind: 'ok', text: 'Bağlantı testi başarılı. Sistem çalışıyor.' }
        : { kind: 'error', text: `${detail.note} Bu sırada Excel / CSV yüklemeyle devam edebilirsiniz.` });
    }
    load();
  }

  async function disable(integration) {
    const { error } = await supabase
      .from('org_integrations')
      .update({ state: 'disabled', updated_at: new Date().toISOString() })
      .eq('id', integration.id);
    if (error) setMessage({ kind: 'error', text: errorText(error) });
    load();
  }

  async function saveWizard() {
    const connector = byCode.get(wizard.code);
    if (!connector) return;
    const fields = (connector.config_fields || []).filter((f) => f.type !== 'secret');
    for (const f of fields) {
      if (f.required && !String(wizard.config[f.key] || '').trim()) {
        setMessage({ kind: 'error', text: `"${f.label}" alanı zorunlu.` });
        return;
      }
    }
    const config = {};
    for (const f of fields) {
      if (wizard.config[f.key]) config[f.key] = String(wizard.config[f.key]).trim();
    }

    setBusy(true);
    let newId = null;
    if (wizard.replacing) {
      const { data, error } = await supabase.rpc('replace_integration', {
        p_old_id: wizard.replacing.id,
        p_connector_code: connector.code,
        p_label: wizard.label || null,
        p_config: config,
      });
      if (error) {
        setBusy(false);
        setMessage({ kind: 'error', text: errorText(error) });
        return;
      }
      newId = data;
    } else {
      const { data, error } = await supabase
        .from('org_integrations')
        .insert({
          org_id: org.id,
          connector_code: connector.code,
          label: wizard.label || null,
          config,
          state: 'draft',
          created_by: user.id,
        })
        .select('id')
        .single();
      if (error) {
        setBusy(false);
        setMessage({ kind: 'error', text: errorText(error) });
        return;
      }
      newId = data.id;
    }
    setBusy(false);
    setWizard(null);
    await load();
    if (newId) {
      await runTest({ id: newId, connector_code: connector.code });
    }
  }

  if (!integrations) return <div className="center">Yükleniyor…</div>;

  const chosen = wizard && wizard.code ? byCode.get(wizard.code) : null;

  return (
    <>
      <div className="page-head">
        <div>
          {isRetailer ? <h2>Kasa ve stok sistemi</h2> : <h1>Entegrasyonlar</h1>}
          <p className="sub">
            {isRetailer
              ? 'Kasa programınızı veya yazar kasanızı değiştirdiğinizde yeni sistemi buradan bağlayın.'
              : 'Muhasebe veya stok programınızı değiştirdiğinizde yeni sistemi buradan bağlayın.'}
          </p>
        </div>
        {!wizard ? <button className="btn primary" onClick={() => openWizard(null)}>Sistem ekle</button> : null}
      </div>

      {message ? <div className={`notice ${message.kind}`} role="status">{message.text}</div> : null}

      {wizard ? (
        <section className="card" aria-label="Sistem bağlama sihirbazı">
          <h2>
            {wizard.replacing
              ? `Sistemi değiştir: ${byCode.get(wizard.replacing.connector_code)?.name || wizard.replacing.connector_code}`
              : 'Yeni sistem bağla'}
          </h2>
          <p className="muted small">Adım {wizard.step} / 2 · {wizard.step === 1 ? 'Sistemi seçin' : 'Bilgileri girin ve test edin'}</p>

          {wizard.step === 1 ? (
            <>
              <div className="connectors">
                {connectors.map((c) => {
                  const selectable = c.status === 'available' || c.status === 'beta';
                  return (
                    <button
                      key={c.code}
                      type="button"
                      className={`connector ${wizard.code === c.code ? 'selected' : ''}`}
                      disabled={!selectable}
                      onClick={() => setWizard({ ...wizard, code: c.code, config: {} })}
                      aria-pressed={wizard.code === c.code}
                    >
                      <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <span className="strong">{c.name}</span>
                        <span className={`badge ${c.status === 'available' ? 'ok' : c.status === 'beta' ? 'info' : ''}`}>
                          {CONNECTOR_STATUS_LABEL[c.status]}
                        </span>
                      </span>
                      <span className="muted small">{c.vendor}</span>
                      <span className="small">{(c.capabilities || []).map((k) => CAPABILITY_LABEL[k] || k).join(' · ')}</span>
                      {c.setup_help ? <span className="muted small">{c.setup_help}</span> : null}
                    </button>
                  );
                })}
              </div>
              <p className="muted small">
                Listede olmayan ya da &quot;Yakında&quot; görünen bir sisteme geçtiyseniz Excel / CSV yüklemeyle devam edin; veri akışı kesilmez.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn primary" disabled={!wizard.code} onClick={() => setWizard({ ...wizard, step: 2 })}>Devam</button>
                <button className="btn" onClick={() => setWizard(null)}>Vazgeç</button>
              </div>
            </>
          ) : (
            <>
              <div className="field" style={{ maxWidth: 420 }}>
                <label htmlFor="w-label">Bağlantı adı (isteğe bağlı)</label>
                <input
                  id="w-label"
                  className="input"
                  placeholder="ör. Merkez depo"
                  value={wizard.label}
                  onChange={(e) => setWizard({ ...wizard, label: e.target.value })}
                />
              </div>
              {(chosen?.config_fields || []).map((f) =>
                f.type === 'secret' ? (
                  <div key={f.key} className="notice small" style={{ maxWidth: 420 }}>
                    {f.label}: bağlantı açıldığında güvenli kasaya kaydedilecek.
                  </div>
                ) : (
                  <div key={f.key} className="field" style={{ maxWidth: 420 }}>
                    <label htmlFor={`w-${f.key}`}>{f.label}{f.required ? ' *' : ''}</label>
                    <input
                      id={`w-${f.key}`}
                      className="input"
                      type={f.type === 'url' ? 'url' : 'text'}
                      value={wizard.config[f.key] || ''}
                      onChange={(e) => setWizard({ ...wizard, config: { ...wizard.config, [f.key]: e.target.value } })}
                    />
                  </div>
                )
              )}
              {!(chosen?.config_fields || []).length ? (
                <p className="muted small">Bu sistem için ek bilgi gerekmiyor.</p>
              ) : null}
              {wizard.replacing ? (
                <div className="notice small">
                  Eski bağlantı silinmez; &quot;Yerine yenisi geldi&quot; olarak geçmişte kalır.
                </div>
              ) : null}
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn primary" onClick={saveWizard} disabled={busy}>{busy ? 'Kaydediliyor…' : 'Kaydet ve test et'}</button>
                <button className="btn" onClick={() => setWizard({ ...wizard, step: 1 })} disabled={busy}>Geri</button>
              </div>
            </>
          )}
        </section>
      ) : null}

      <section className="card">
        <h2>Bağlı sistemleriniz</h2>
        {!current.length ? (
          <p className="muted">Henüz bağlı sistem yok. &quot;Sistem ekle&quot; ile başlayın.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Sistem</th>
                  <th>Durum</th>
                  <th>Son test</th>
                  <th>Son veri aktarımı</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {current.map((i) => {
                  const c = byCode.get(i.connector_code);
                  return (
                    <tr key={i.id}>
                      <td className="strong">
                        {c ? c.name : i.connector_code}
                        {i.label ? <div className="muted small">{i.label}</div> : null}
                        {isRetailer && i.is_primary_stock_source ? <div><span className="badge ok">Ana stok kaynağı</span></div> : null}
                        {i.last_error ? <div className="warn-text small">{i.last_error}</div> : null}
                      </td>
                      <td>{stateBadge(i.state)}</td>
                      <td className="muted small">{dateTime(i.last_test_at)}</td>
                      <td className="muted small">{dateTime(i.last_sync_at)}</td>
                      <td>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end' }}>
                          <button className="btn small" onClick={() => runTest(i)}>Test et</button>
                          <button className="btn small outline" onClick={() => openWizard(i)}>Sistemi değiştir</button>
                          <button className="btn small" onClick={() => disable(i)}>Kapat</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {history.length ? (
        <section className="card">
          <h2>Geçmiş bağlantılar</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Sistem</th><th>Durum</th><th>Eklendi</th><th>Son değişiklik</th></tr>
              </thead>
              <tbody>
                {history.map((i) => (
                  <tr key={i.id}>
                    <td>{byCode.get(i.connector_code)?.name || i.connector_code}{i.label ? <span className="muted"> · {i.label}</span> : null}</td>
                    <td>{stateBadge(i.state)}</td>
                    <td className="muted small">{dateTime(i.created_at)}</td>
                    <td className="muted small">{dateTime(i.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
