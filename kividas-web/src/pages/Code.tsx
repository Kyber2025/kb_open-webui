import { useEffect, useState } from "react";
import { ArrowUpRight, Copy, Download, KeyRound, Terminal } from "lucide-react";
import { request } from "../lib/api";
import {
  cliPlatforms,
  desktopBuilds,
  installCommands,
  safeDownload,
  type CliRelease,
  type DesktopRelease,
} from "../lib/downloads";
import { useNotify } from "../components/UI";
import { GatewayResources } from "../components/GatewayResources";

export function CodeDownloads({ onGateway }: { onGateway: () => void }) {
  const [desktop, setDesktop] = useState<DesktopRelease | null>(null);
  const [cli, setCli] = useState<CliRelease | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [copied, setCopied] = useState("");
  const notify = useNotify();
  const isMac = /Mac/i.test(navigator.platform || navigator.userAgent);
  const builds = desktopBuilds(desktop);
  const macZip = new URL(builds.mac.url).pathname.endsWith(".zip");
  const order: Array<"mac" | "windows"> = isMac
    ? ["mac", "windows"]
    : ["windows", "mac"];
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
    <div className="page code-download-page">
      <header className="code-page-heading">
        <span className="eyebrow">KIVIDAS CODE</span>
        <h1>A little more room to build.</h1>
        <p className="muted">
          Your Kividas account, on your desktop and in your terminal.
        </p>
      </header>
      <section
        className="download-panel desktop-downloads"
        aria-labelledby="desktop-heading"
      >
        <div className="download-icon">
          <img src="/kividas-code.png" alt="Kividas Code" width={64} height={64}/>
        </div>
        <h2 id="desktop-heading">Kividas Code</h2>
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
                {platform === "mac" ? `macOS (${macZip ? ".zip" : ".dmg"})` : "Windows (.exe)"}
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
      </section>
      <section className="download-panel gateway-downloads" aria-labelledby="gateway-heading">
        <div className="gateway-section-heading"><span className="gateway-resource-icon"><KeyRound size={22} /></span><div><span className="eyebrow">YOUR SUBSCRIPTION, CONNECTED</span><h2 id="gateway-heading">Claude Code Gateway</h2></div></div>
        <p className="muted">使用 Kividas 订阅接入官方 Claude 桌面客户端和 Claude Code CLI。</p>
        <ol className="gateway-steps">
          <li><span>1</span><div><strong>下载你的接入资料</strong><p>头像菜单 → Gateway，获取管理员为你发放的专属 Key 和安装识别码。</p></div></li>
          <li><span>2</span><div><strong>按教程完成配置</strong><p>选择对应的 Mac、Windows 或 CLI 教程；也可下载配置工具并导入客户资料 TXT。</p></div></li>
          <li><span>3</span><div><strong>重启客户端，开始使用</strong><p>完全退出后重新打开。桌面端和 CLI 的用量计入你的 Kividas 订阅。</p></div></li>
        </ol>
        <button className="btn primary gateway-open" onClick={onGateway}>我的 Gateway 接入资料<ArrowUpRight size={17} /></button>
        <GatewayResources />
        <p className="gateway-mac-help">Mac 配置工具：解压后，在终端输入 <code>/bin/bash </code>（末尾留一个空格），再拖入“配置Mac.sh”并回车。完整步骤见压缩包内的“Mac启动说明.txt”。</p>
      </section>
      <section
        className="download-panel cli-downloads"
        aria-labelledby="cli-heading"
      >
        <div className="cli-heading">
          <h2 id="cli-heading">
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
          chat.kividas.com, and <code>kividas</code> to open the terminal.
          Windows also needs Git for Windows (Git Bash), which Claude Code uses
          to run commands.
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
              macOS: unzip and open “Kividas CLI” to install the command and
              open a Terminal. Linux: run <code>chmod +x kividas</code>, then{" "}
              <code>./kividas</code>.
            </p>
          </>
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
