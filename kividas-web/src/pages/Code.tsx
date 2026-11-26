import {
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router-dom";
import {
  ArrowUpRight,
  Check,
  KeyRound,
  Terminal,
} from "lucide-react";
import {
  codeMethods,
  defaultCodeMethod,
  parseCodeMethod,
  type CodeMethodId,
} from "../lib/code-methods";
import { WorkspaceSetup } from "../components/WorkspaceSetup";
import { GatewayResources } from "../components/GatewayResources";
import { ClaudeAppIcon } from "../components/ClaudeAppIcon";

const methodIcons: Record<CodeMethodId, ReactNode> = {
  ssh: <Terminal size={24} />,
  gateway: <ClaudeAppIcon className="code-method-app-icon" />,
};

export function CodeDownloads({ onGateway }: { onGateway: () => void; usageUrl?: string }) {
  const [params, setParams] = useSearchParams();
  const selected = parseCodeMethod(params.get("method"));
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
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
          在云端工作区使用 Claude，或连接你自己的桌面和终端。选择适合你的方式。
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
        className={`download-panel code-method-panel ${selected}-downloads`}
      >
        {selected === "ssh" ? <WorkspaceSetup /> : <GatewayPanel onGateway={onGateway} />}
      </section>
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
      <GatewayResources configurationNote={<p className="gateway-mac-help">
        完整解压后，Windows 双击“配置Windows.cmd”。Mac 在终端输入 <code>/bin/bash </code>
        （末尾留一个空格），再拖入“配置Mac.sh”并回车。详细步骤见压缩包内的“Mac启动说明.txt”。
      </p>} />
    </>
  );
}
