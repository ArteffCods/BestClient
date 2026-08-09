'use client';

import { useEffect, useState } from 'react';

import type { AppInfo, AuthConfigStatus, PublicSettings, ServerListEntry } from '@/types/bestclient';

interface Props {
  info: AppInfo | null;
  settings: PublicSettings | null;
  servers: ServerListEntry[];
  busy: boolean;
  onPatch: (patch: Partial<PublicSettings>) => void;
  onRepair: () => void;
}

export function SettingsView({ info, settings, servers, busy, onPatch, onRepair }: Props) {
  const [note, setNote] = useState<string | null>(null);
  const [authConfig, setAuthConfig] = useState<AuthConfigStatus | null>(null);
  const [clientId, setClientId] = useState('');
  const [authNote, setAuthNote] = useState<string | null>(null);

  useEffect(() => {
    void window.bestclient.getAuthConfig().then(setAuthConfig);
  }, []);

  if (!settings || !info) {
    return <p className="text-sm text-ink-faint">Beállítások betöltése…</p>;
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h2 className="rise display-caps text-[26px] leading-none text-ink">Beállítások</h2>

      <div className="mt-7 space-y-4">
        <Section title="Memória" delay={60}>
          <p className="mb-4 text-[12px] leading-relaxed text-ink-faint">
            A JVM-nek adott maximum. PvP-hez 4–6 GB bőven elég: a felesleges heap nem hoz FPS-t,
            viszont hosszabb GC-szünetet igen, és a szünet az, ami elveszi a találatot.
          </p>
          <div className="flex items-center gap-5">
            <input
              type="range"
              min={2048}
              max={12288}
              step={512}
              value={settings.memoryMb}
              onChange={(event) => onPatch({ memoryMb: Number(event.target.value) })}
              aria-label="Memória"
              className="h-1 flex-1 accent-rose"
            />
            <span className="w-16 text-right font-mono text-[15px] tabular-nums text-rose-soft">
              {(settings.memoryMb / 1024).toFixed(1)} GB
            </span>
          </div>
        </Section>

        <Section title="Szerverlista" delay={100}>
          {servers.length === 0 ? (
            <p className="text-[12px] text-ink-faint">
              Még nincs szerverlista – az első indítás után jelenik meg.
            </p>
          ) : (
            <ul className="space-y-px overflow-hidden rounded border border-edge">
              {servers.map((server) => (
                <li
                  key={server.address}
                  className="flex items-center justify-between bg-panel-high px-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] text-ink">{server.name}</span>
                    <span className="block font-mono text-[10px] text-ink-faint">{server.address}</span>
                  </span>
                  {server.locked ? (
                    <span className="shrink-0 rounded border border-rose/50 px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-rose-soft">
                      rögzített
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11.5px] leading-relaxed text-ink-faint">
            A <span className="font-mono text-ink-dim">{info.lockedServer.address}</span> bejegyzést a
            launcher minden indítás előtt visszaírja a lista elejére. Játék közben törölhető, de a
            következő indításnál újra ott lesz.
          </p>
        </Section>

        <Section title="Indítás" delay={140}>
          <label className="flex cursor-pointer items-center justify-between py-1.5">
            <span className="text-[13px] text-ink">Launcher elrejtése indításkor</span>
            <input
              type="checkbox"
              checked={settings.closeOnLaunch}
              onChange={(event) => onPatch({ closeOnLaunch: event.target.checked })}
              className="h-3.5 w-3.5 accent-rose"
            />
          </label>

          <div className="pt-3">
            <label className="eyebrow mb-2 block" htmlFor="jvm-args">
              Extra JVM-argumentumok
            </label>
            <input
              id="jvm-args"
              type="text"
              value={settings.extraJvmArgs}
              placeholder="-XX:+UseStringDeduplication"
              onChange={(event) => onPatch({ extraJvmArgs: event.target.value })}
              className="w-full rounded border border-edge bg-void px-3 py-2 font-mono text-[11px] text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-rose"
            />
          </div>
        </Section>

        <Section title="Microsoft auth" delay={160}>
          <div className="space-y-3">
            <p className="text-[11.5px] leading-relaxed text-ink-dim">
              A launcher beépített publikus client ID-vel működik – bejelentkezéshez nem kell
              semmit beállítanod. Ha saját Azure appot akarsz használni, add meg az ID-t itt.
            </p>

            <div>
              <label className="eyebrow mb-2 block" htmlFor="azure-client-id">
                Azure Application client ID (opcionális)
              </label>
              <input
                id="azure-client-id"
                type="text"
                value={clientId}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                onChange={(event) => setClientId(event.target.value)}
                className="w-full rounded border border-edge bg-void px-3 py-2 font-mono text-[11px] text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-rose"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Action
                onClick={async () => {
                  setAuthNote(null);
                  try {
                    setAuthConfig(await window.bestclient.setAuthClientId(clientId));
                    setClientId('');
                    setAuthNote('Saját client ID mentve – onnantól azzal jelentkezik be a launcher.');
                  } catch (error) {
                    setAuthNote(error instanceof Error ? error.message : String(error));
                  }
                }}
              >
                Client ID mentése
              </Action>
              <Action onClick={() => void window.bestclient.openExternal('https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade')}>
                Azure appok
              </Action>
              <Action
                onClick={async () => {
                  setAuthConfig(await window.bestclient.setAuthClientId(''));
                }}
              >
                Vissza az alapértelmezettre
              </Action>
            </div>

            <p className="text-[11.5px] leading-relaxed text-ink-faint">
              Állapot:{' '}
              <span className="text-rose-soft">
                {authConfig?.source === 'env'
                  ? 'környezeti változó'
                  : authConfig?.source === 'file'
                    ? 'saját'
                    : 'alapértelmezett'}
              </span>
              {authConfig?.file ? <span className="block truncate font-mono">{authConfig.file}</span> : null}
            </p>

            {authNote ? <p className="text-[11.5px] text-rose-soft">{authNote}</p> : null}
          </div>
        </Section>

        <Section title="Karbantartás" delay={200}>
          <div className="flex flex-wrap gap-2">
            <Action
              disabled={busy}
              onClick={() => {
                setNote(null);
                onRepair();
              }}
            >
              {busy ? 'Ellenőrzés fut…' : 'Fájlok ellenőrzése és javítása'}
            </Action>
            <Action
              onClick={async () => {
                const result = await window.bestclient.resetPvpOptions();
                setNote(`${result.applied.length} beállítás visszaállítva.`);
              }}
            >
              PvP alapbeállítások visszaállítása
            </Action>
            <Action onClick={() => void window.bestclient.openInstanceFolder()}>
              Játék mappa megnyitása
            </Action>
          </div>

          <p className="mt-3 text-[11.5px] leading-relaxed text-ink-faint">
            Normál indításkor a launcher méret alapján ellenőrzi a meglévő fájlokat – a letöltéskori
            SHA-1 ellenőrzés után ez elég, és nem olvas be több száz megabájtot minden indulásnál. Az
            ellenőrzés-gomb az, ami minden fájlt újra végighashel és pótolja, ami sérült.
          </p>

          {note ? <p className="mt-2 text-[11.5px] text-rose-soft">{note}</p> : null}
        </Section>

        <Section title="Verziók" delay={240}>
          <dl className="grid grid-cols-2 gap-y-2 text-[12px]">
            <Row term="Launcher" value={info.version} />
            <Row term="Minecraft" value={info.target.minecraft} />
            <Row term="Fabric Loader" value={info.target.fabricLoader} />
            <Row term="Java" value={String(info.target.javaMajor)} />
          </dl>
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  delay,
  children,
}: {
  title: string;
  delay: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rise rounded-lg border border-edge bg-panel p-5" style={{ animationDelay: `${delay}ms` }}>
      <h3 className="eyebrow mb-3">{title}</h3>
      {children}
    </section>
  );
}

function Action({
  children,
  onClick,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded border border-edge px-3 py-2 text-[11.5px] text-ink-dim transition-colors hover:border-rose/60 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function Row({ term, value }: { term: string; value: string }) {
  return (
    <>
      <dt className="text-ink-faint">{term}</dt>
      <dd className="text-right font-mono tabular-nums text-ink">{value}</dd>
    </>
  );
}
