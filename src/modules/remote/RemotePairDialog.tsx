import { useEffect, useState } from 'react';
import { toDataURL } from 'qrcode';
import { Icon } from '../../modules/icons';
import { useT } from '../../i18n/locale';
import type { RemoteAddress } from './remoteControlApi';
import type { RemoteControlHost } from './useRemoteControlHost';
import './remote-pair.css';

const QR_SIZE_PX = 200;
const CLOCK_INTERVAL_MS = 1000;

function useQrDataUrl(url: string): { dataUrl: string; error: boolean } {
  const [dataUrl, setDataUrl] = useState('');
  const [error, setError] = useState(false);
  useEffect(() => {
    setError(false);
    if (!url) { setDataUrl(''); return; }
    let active = true;
    void toDataURL(url, { width: QR_SIZE_PX, margin: 1, errorCorrectionLevel: 'M' })
      .then((data) => { if (active) setDataUrl(data); })
      .catch(() => { if (active) { setDataUrl(''); setError(true); } });
    return () => { active = false; };
  }, [url]);
  return { dataUrl, error };
}

function addressLabel(address: RemoteAddress): string {
  return `${address.label} · ${new URL(address.url).host}`;
}

function PairBody({ host }: { host: RemoteControlHost }) {
  const t = useT();
  const session = host.session!;
  const [selected, setSelected] = useState(session.addresses[0]?.url ?? '');
  const [now, setNow] = useState(Date.now());
  const { dataUrl: qrDataUrl, error: qrError } = useQrDataUrl(selected);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.ceil((session.expiresAt - now) / CLOCK_INTERVAL_MS));
  const copyLink = () => {
    void navigator.clipboard.writeText(selected)
      .catch(() => { window.prompt(t('Copy failed. Copy the link manually.'), selected); });
  };
  return <div className="cc-remote-pair-body">
    <div className="cc-remote-pair-qr">
      {qrDataUrl
        ? <img src={qrDataUrl} alt={t('Phone remote QR code')} />
        : <span>{t(qrError ? 'Could not generate the QR code. Copy the link instead.' : 'Generating QR code…')}</span>}
    </div>
    <div className="cc-remote-pair-side">
      <ol>
        <li>{t('Put the phone and this computer on the same Wi-Fi or hotspot')}</li>
        <li>{t('Scan the QR code on the left with your phone camera')}</li>
        <li>{t('Then send prompts from the phone and watch the results live')}</li>
      </ol>
      {session.addresses.length > 1 && <label>{t('Local network address')}
        <select value={selected} onChange={(event) => setSelected(event.target.value)}>
          {session.addresses.map((address) => <option key={address.url} value={address.url}>{addressLabel(address)}</option>)}
        </select>
      </label>}
      <div className="cc-remote-pair-link"><code>{selected}</code><button type="button" onClick={copyLink}>{t('Copy link')}</button></div>
      <p className="cc-remote-pair-timer">{seconds > 0 ? t('Channel closes in {seconds} seconds', { seconds }) : t('The remote channel expired. Close this and try again.')}</p>
      <div className={host.guestCount > 0 ? 'cc-remote-pair-status live' : 'cc-remote-pair-status'}>
        <span className="cc-remote-pair-dot" />
        {host.guestCount > 0 ? t('{n} phone(s) connected', { n: host.guestCount }) : t('Waiting for a phone')}
      </div>
    </div>
  </div>;
}

/**
 * Pairing sheet for the phone remote. Mounted from the chat header, so the
 * session only exists while this is open — closing it drops the LAN listener.
 */
export function RemotePairDialog({ host, onClose }: { host: RemoteControlHost; onClose: () => void }) {
  const t = useT();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return <div className="cc-modal-backdrop" role="dialog" aria-modal="true" aria-label={t('Phone remote')} onClick={onClose}>
    <div className="cc-remote-pair-dialog cc-glass" onClick={(event) => event.stopPropagation()}>
      <header>
        <div>
          <strong>{t('Phone remote')}</strong>
          <span>{t('Scan to drive the agent from your phone')}</span>
        </div>
        <button type="button" autoFocus aria-label={t('Close')} onClick={onClose}><Icon name="x" size={18} /></button>
      </header>
      {host.session && <PairBody key={host.session.id} host={host} />}
      {!host.session && !host.error && <div className="cc-remote-pair-loading">{t('Opening a local network remote channel…')}</div>}
      {host.error && <div className="cc-remote-pair-error">{t('Phone remote unavailable: {error}', { error: host.error })}</div>}
      <footer>
        <span>{t('The remote channel stays open for this session only and never exposes the editor or API keys.')}</span>
        <button type="button" onClick={host.restart} disabled={host.starting}>{t('New QR code')}</button>
        <button type="button" className="primary" onClick={onClose}>{t('Done')}</button>
      </footer>
    </div>
  </div>;
}
