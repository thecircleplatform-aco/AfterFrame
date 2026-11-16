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
      .catch(() => { window.prompt(t('复制失败，请手动复制链接'), selected); });
  };
  return <div className="cc-remote-pair-body">
    <div className="cc-remote-pair-qr">
      {qrDataUrl
        ? <img src={qrDataUrl} alt={t('手机遥控二维码')} />
        : <span>{t(qrError ? '二维码生成失败，请复制链接' : '正在生成二维码…')}</span>}
    </div>
    <div className="cc-remote-pair-side">
      <ol>
        <li>{t('让手机与电脑连接同一 Wi-Fi 或热点')}</li>
        <li>{t('用手机相机扫描左侧二维码')}</li>
        <li>{t('扫码后即可在手机上发送指令并查看结果')}</li>
      </ol>
      {session.addresses.length > 1 && <label>{t('局域网地址')}
        <select value={selected} onChange={(event) => setSelected(event.target.value)}>
          {session.addresses.map((address) => <option key={address.url} value={address.url}>{addressLabel(address)}</option>)}
        </select>
      </label>}
      <div className="cc-remote-pair-link"><code>{selected}</code><button type="button" onClick={copyLink}>{t('复制链接')}</button></div>
      <p className="cc-remote-pair-timer">{seconds > 0 ? t('通道将在 {seconds} 秒后关闭', { seconds }) : t('遥控通道已过期，请关闭后重试')}</p>
      <div className={host.guestCount > 0 ? 'cc-remote-pair-status live' : 'cc-remote-pair-status'}>
        <span className="cc-remote-pair-dot" />
        {host.guestCount > 0 ? t('已连接 {n} 台手机', { n: host.guestCount }) : t('等待手机连接')}
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
  return <div className="cc-modal-backdrop" role="dialog" aria-modal="true" aria-label={t('手机遥控')} onClick={onClose}>
    <div className="cc-remote-pair-dialog cc-glass" onClick={(event) => event.stopPropagation()}>
      <header>
        <div>
          <strong>{t('手机遥控')}</strong>
          <span>{t('扫码后从手机指挥智能体')}</span>
        </div>
        <button type="button" autoFocus aria-label={t('关闭')} onClick={onClose}><Icon name="x" size={18} /></button>
      </header>
      {host.session && <PairBody key={host.session.id} host={host} />}
      {!host.session && !host.error && <div className="cc-remote-pair-loading">{t('正在建立局域网遥控通道…')}</div>}
      {host.error && <div className="cc-remote-pair-error">{t('遥控通道不可用：{error}', { error: host.error })}</div>}
      <footer>
        <span>{t('仅在本次会话中临时开放遥控通道，不会暴露编辑器或 API 密钥。')}</span>
        <button type="button" onClick={host.restart} disabled={host.starting}>{t('再次生成二维码')}</button>
        <button type="button" className="primary" onClick={onClose}>{t('完成')}</button>
      </footer>
    </div>
  </div>;
}
