import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router-dom";
import {
  ArrowUpRight,
  Check,
  Copy,
  Download,
  KeyRound,
  Terminal,
} from "lucide-react";
import { request } from "../lib/api";
import {
  cliPlatforms,
  desktopBuilds,
  installCommands,
  safeDownload,
  type CliRelease,
  type DesktopRelease,
} from "../lib/downloads";
import {
  codeMethods,
  defaultCodeMethod,
  parseCodeMethod,
  type CodeMethodId,
} from "../lib/code-methods";
import { useNotify } from "../components/UI";
import { GatewayResources } from "../components/GatewayResources";

type Platform = "mac" | "windows";
type Builds = ReturnType<typeof desktopBuilds>;

const methodIcons: Record<CodeMethodId, ReactNode> = {
  gateway: <KeyRound size={22} />,
  desktop: <img src="/kividas-code.png" alt="" width={40} height={40} />,
  cli: <Terminal size={22} />,
};
const panelClass: Record<CodeMethodId, string> = {
  gateway: "gateway-downloads",
  desktop: "desktop-downloads",
  cli: "cli-downloads",
};

export function CodeDownloads({ onGateway }: { onGateway: () => void }) {
  const [desktop, setDesktop] = useState<DesktopRelease | null>(null);
  const [cli, setCli] = useState<CliRelease | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [params, setParams] = useSearchParams();
  const selected = parseCodeMethod(params.get("method"));
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const isMac = /Mac/i.test(navigator.platform || navigator.userAgent);
  const builds = desktopBuilds(desktop);
  const order: Platform[] = isMac ? ["mac", "windows"] : ["windows", "mac"];
  const versions: Partial<Record<CodeMethodId, string | null | undefined>> = {
    desktop: builds[order[0]].version,
    cli: cli?.version,
  };
  async function load() {
    setLoading(true);
    const [desktopResult, cliResult] = await Promise.allSettled([
      request<DesktopRelease>("/api/v1/code/latest"),
      request<CliRelease>("/api/v1/code/cli"),
    ]);
    const failed = [];
    if (desktopResult.status === "fulfilled") setDesktop(desktopResult.value);
    else failed.push("desktop");
    if (cliResult.status === "fulfilled") setCli(cliResult.value);
    else failed.push("CLI");
    setUnavailable(failed);
    setLoading(false);
  }
  useEffect(() => {
    void load();
  }, []);
  function select(id: CodeMethodId) {
    if (id === selected) return;
    const next = new URLSearchParams(params);
    if (id === defaultCodeMethod) next.delete("method");
    else next.set("method", id);
    setParams(next, { replace: true });
  }
  function onTabKey(event: KeyboardEvent<HTMLDivElement>) {
    const current = codeMethods.findIndex((method) => method.id === selected);
    const last = codeMethods.length - 1;
    const index =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? (current + 1) % codeMethods.length
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? (current + last) % codeMethods.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : -1;
    if (index < 0) return;
    event.preventDefault();
    select(codeMethods[index].id);
    tabs.current[index]?.focus();
  }
  return (
    <div className="page code-download-page">
      <header className="code-page-heading">
        <span className="eyebrow">KIVIDAS CODE</span>
        <h1>A little more room to build.</h1>
        <p className="muted">
          三种方式把 Kividas 账号接入你的桌面和终端，点击卡片查看对应的配置步骤。
        </p>
      </header>
      <div
        className="code-methods"
        role="tablist"
        aria-label="接入方式"
        onKeyDown={onTabKey}
      >
        {codeMethods.map((method, index) => {
          const active = method.id === selected;
          const version = versions[method.id];
          return (
            <button
              key={method.id}
              ref={(element) => {
                tabs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`code-tab-${method.id}`}
              className="code-method"
              aria-selected={active}
              aria-controls={`code-panel-${method.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => select(method.id)}
            >
              <span className="code-method-icon" aria-hidden="true">
                {methodIcons[method.id]}
              </span>
              {method.badge && (
                <span className="code-method-badge">{method.badge}</span>
              )}
              <span className="code-method-copy">
                <span className="code-method-tagline">
                  {method.tagline}
                  {version && ` · v${version}`}
                </span>
                <strong>{method.title}</strong>
                <span className="code-method-desc">{method.description}</span>
              </span>
              <span className="code-method-foot">
                <span>{method.platforms}</span>
                <span className="code-method-radio" aria-hidden="true">
                  <Check size={13} strokeWidth={2.5} />
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <section
        key={selected}
        role="tabpanel"
        id={`code-panel-${selected}`}
        aria-labelledby={`code-tab-${selected}`}
        className={`download-panel code-method-panel ${panelClass[selected]}`}
      >
        {selected === "gateway" ? (
          <GatewayPanel onGateway={onGateway} />
        ) : selected === "desktop" ? (
          <DesktopPanel builds={builds} order={order} />
        ) : (
          <CliPanel cli={cli} />
        )}
      </section>
      <div className="download-status" role="status">
        {loading ? (
          "Checking for the latest releases…"
        ) : unavailable.length > 0 ? (
          <>
            <span>
              Could not refresh {unavailable.join(" and ")} releases. Available
              installers and installation commands are still shown.
            </span>
            <button className="text-btn" onClick={() => void load()}>
              Try again
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function GatewayPanel({ onGateway }: { onGateway: () => void }) {
  return (
    <>
      <div className="gateway-section-heading">
        <span className="gateway-resource-icon">
          <KeyRound size={22} />
        </span>
        <div>
          <span className="eyebrow">YOUR SUBSCRIPTION, CONNECTED</span>
          <h2>Claude Code Gateway</h2>
        </div>
      </div>
      <p className="muted">
        使用 Kividas 订阅接入官方 Claude 桌面客户端和 Claude Code CLI。
      </p>
      <ol className="gateway-steps">
        <li>
          <span>1</span>
          <div>
            <strong>生成并下载接入资料</strong>
            <p>
              头像菜单 → Gateway，自行生成专属 Key
              和安装识别码，也可下载管理员已为你生成的资料。
            </p>
          </div>
        </li>
        <li>
          <span>2</span>
          <div>
            <strong>按教程完成配置</strong>
            <p>
              选择对应的 Mac、Windows 或 CLI 教程；也可下载配置工具并导入客户资料
              TXT。
            </p>
          </div>
        </li>
        <li>
          <span>3</span>
          <div>
            <strong>重启客户端，开始使用</strong>
            <p>完全退出后重新打开。桌面端和 CLI 的用量计入你的 Kividas 订阅。</p>
          </div>
        </li>
      </ol>
      <button className="btn primary gateway-open" onClick={onGateway}>
        我的 Gateway 接入资料
        <ArrowUpRight size={17} />
      </button>
      <GatewayResources />
      <p className="gateway-mac-help">
        Mac 配置工具：解压后，在终端输入 <code>/bin/bash </code>
        （末尾留一个空格），再拖入“配置Mac.sh”并回车。完整步骤见压缩包内的“Mac启动说明.txt”。
      </p>
    </>
  );
}

function DesktopPanel({
  builds,
  order,
}: {
  builds: Builds;
  order: Platform[];
}) {
  const macZip = new URL(builds.mac.url).pathname.endsWith(".zip");
  return (
    <>
      <div className="download-icon">
        <img src="/kividas-code.png" alt="Kividas Code" width={64} height={64} />
      </div>
      <h2>Kividas Code</h2>
      <p className="muted">AI coding desktop client for Windows and macOS.</p>
      <div className="desktop-buttons">
        {order.map((platform, index) => (
          <div className="desktop-build" key={platform}>
            <a
              className={`btn ${index === 0 ? "primary" : ""}`}
              href={builds[platform].url}
              download
            >
              <Download size={18} />
              Download for{" "}
              {platform === "mac"
                ? `macOS (${macZip ? ".zip" : ".dmg"})`
                : "Windows (.exe)"}
            </a>
            <small>
              {platform === "mac" && "Apple Silicon · "}Version{" "}
              {builds[platform].version}
            </small>
            {platform === "mac" && macZip && (
              <small>Unzip and drag Kividas Code to Applications.</small>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function CliPanel({ cli }: { cli: CliRelease | null }) {
  const [copied, setCopied] = useState("");
  const notify = useNotify();
  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(""), 1800);
    return () => clearTimeout(timeout);
  }, [copied]);
  async function copy(key: "sh" | "ps1") {
    try {
      await navigator.clipboard.writeText(installCommands[key]);
      setCopied(key);
    } catch {
      notify("Could not copy. Select the command and copy it manually.", true);
    }
  }
  const direct = cliPlatforms.filter(({ key }) =>
    safeDownload(cli?.platforms?.[key]?.url),
  );
  return (
    <>
      <div className="cli-heading">
        <h2>
          <Terminal size={21} />
          Kividas CLI
        </h2>
        <small>
          {cli?.version && (
            <>
              Version {cli.version}
              {cli.claude_version && <> · Claude Code {cli.claude_version}</>}
            </>
          )}
        </small>
      </div>
      <p className="muted">
        Run Claude Code with your Kividas account from any terminal on macOS,
        Windows or Linux. No Node.js or npm required.
      </p>
      {(["sh", "ps1"] as const).map((key) => (
        <div className="install-command" key={key}>
          <label htmlFor={`install-${key}`}>
            {key === "sh" ? "macOS / Linux" : "Windows (PowerShell)"}
          </label>
          <div>
            <code id={`install-${key}`}>{installCommands[key]}</code>
            <button
              className="btn"
              aria-label={`Copy ${key === "sh" ? "macOS / Linux" : "Windows"} install command`}
              onClick={() => void copy(key)}
            >
              <Copy size={14} />
              {copied === key ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      ))}
      <p className="cli-help">
        Then run <code>kividas login</code> with the same account as
        chat.kividas.com, and <code>kividas</code> to open the terminal. Windows
        also needs Git for Windows (Git Bash), which Claude Code uses to run
        commands.
      </p>
      {direct.length > 0 && (
        <>
          <nav className="direct-downloads" aria-label="CLI direct downloads">
            <span>Direct downloads:</span>
            {direct.map(({ key, name }) => (
              <a key={key} href={cli!.platforms![key]!.url} download>
                {name}
              </a>
            ))}
          </nav>
          <p className="cli-help">
            macOS: unzip and open “Kividas CLI” to install the command and open
            a Terminal. Linux: run <code>chmod +x kividas</code>, then{" "}
            <code>./kividas</code>.
          </p>
        </>
      )}
    </>
  );
}
