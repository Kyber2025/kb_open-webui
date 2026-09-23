import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowUp,
  Check,
  Code2,
  Coffee,
  Copy,
  FileText,
  Ghost,
  Globe,
  GraduationCap,
  Lightbulb,
  Loader2,
  Mic,
  Paperclip,
  Pencil,
  Plus,
  Square,
  Sparkles,
  X,
} from "lucide-react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { preferencesApi } from "../lib/preferences";
import {
  skillsApi,
  selectedSkillIds,
  type Skill,
  type Capability,
} from "../lib/skills";
import { ModelPicker } from "../components/ModelPicker";
import {
  effortOptions,
  modelLabel,
  reasoningParams,
  supportsEffort,
  validEffort,
  type Effort,
} from "../lib/model-menu";
import { api, complete } from "../lib/api";
import { activeMessages, chatPayload } from "../lib/domain";
import type {
  Attachment,
  ChatData,
  Config,
  Message,
  Model,
  User,
} from "../lib/types";
import { ErrorPanel, Loading, messageOf, useNotify } from "../components/UI";
export function BrandMark({ small = false }: { small?: boolean }) {
  return (
    <img
      className={`brand-mark ${small ? "small" : ""}`}
      src="/kividas-code.png"
      alt="Kividas"
    />
  );
}

const categories = [
  {
    name: "Write",
    icon: Pencil,
    prompts: [
      "Create a clear technical explanation",
      "Draft a presentation script",
      "Brainstorm creative ideas",
      "Write an executive summary",
      "Plan a content calendar",
    ],
  },
  {
    name: "Learn",
    icon: GraduationCap,
    prompts: [
      "Explain a complex topic simply",
      "Help me practice a new language",
      "Make a study plan",
      "Quiz me on a topic I am learning",
    ],
  },
  {
    name: "Code",
    icon: Code2,
    prompts: [
      "Help me debug a piece of code",
      "Explain how this code works",
      "Design a simple web application",
      "Review code and suggest improvements",
    ],
  },
  {
    name: "Life stuff",
    icon: Coffee,
    prompts: [
      "Plan a week of meals",
      "Help me organize my day",
      "Brainstorm a thoughtful gift",
      "Plan a weekend trip",
    ],
  },
  {
    name: "Kividas’s choice",
    icon: Lightbulb,
    prompts: [
      "Teach me something unexpected",
      "Help me think through a decision",
      "Explore a new idea together",
    ],
  },
];
function Markdown({ text }: { text: string }) {
  return (
    <div
      className="markdown"
      dangerouslySetInnerHTML={{
        __html: DOMPurify.sanitize(
          marked.parse(text, { async: false }) as string,
        ),
      }}
    />
  );
}
export function ChatPage({
  user,
  models,
  config,
  onSaved,
  onLogin,
}: {
  user: User | null;
  models: Model[];
  config: Config;
  onSaved: () => void;
  onLogin: () => void;
}) {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate(),
    notify = useNotify();
  const [messages, setMessages] = useState<Message[]>([]),
    [draft, setDraft] = useState(""),
    [model, setModel] = useState(localStorage.getItem("kividas:model") || ""),
    [showModels, setShowModels] = useState(false),
    [effort, setEffort] = useState<Effort>(() =>
      validEffort(localStorage.getItem("kividas:effort")),
    ),
    [showAttach, setShowAttach] = useState(false),
    [category, setCategory] = useState<number | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [temporary, setTemporary] = useState(false),
    [webSearch, setWebSearch] = useState(false),
    [memory, setMemory] = useState(false),
    [systemPrompt, setSystemPrompt] = useState(""),
    [files, setFiles] = useState<Attachment[]>([]),
    [uploading, setUploading] = useState(false),
    [listening, setListening] = useState(false);
  const [skills, setSkills] = useState<Skill[]>([]),
    [chosenSkills, setChosenSkills] = useState<string[]>([]),
    [skillsError, setSkillsError] = useState(""),
    [skillsLoading, setSkillsLoading] = useState(true),
    [connectors, setConnectors] = useState<Capability[]>([]),
    [chosenTools, setChosenTools] = useState<string[]>([]),
    [toolsLoading, setToolsLoading] = useState(true),
    [toolsError, setToolsError] = useState("");
  useEffect(() => {
    let alive = true;
    setConnectors([]);
    setToolsError("");
    setToolsLoading(!!user);
    if (user)
      skillsApi
        .connectors()
        .then((items) => {
          if (alive) setConnectors(items);
        })
        .catch((e) => {
          if (alive) setToolsError(messageOf(e));
        })
        .finally(() => {
          if (alive) setToolsLoading(false);
        });
    return () => {
      alive = false;
    };
  }, [user?.id]);
  useEffect(() => {
    let alive = true;
    setSkillsError("");
    setSkills([]);
    setSkillsLoading(!!user);
    if (user) {
      skillsApi
        .all()
        .then((items) => {
          if (alive) setSkills(items);
        })
        .catch((e) => {
          if (alive) setSkillsError(messageOf(e));
        })
        .finally(() => {
          if (alive) setSkillsLoading(false);
        });
    } else setSkills([]);
    return () => {
      alive = false;
    };
  }, [user?.id]);
  useEffect(() => {
    let active = true;
    const load = () => {
      setSystemPrompt("");
      if (user)
        preferencesApi
          .get()
          .then((p) => {
            if (active) setSystemPrompt(p?.ui?.system || "");
          })
          .catch(() => {});
    };
    load();
    window.addEventListener("preferences-updated", load);
    return () => {
      active = false;
      window.removeEventListener("preferences-updated", load);
    };
  }, [user?.id]);
  const input = useRef<HTMLTextAreaElement>(null),
    fileInput = useRef<HTMLInputElement>(null),
    bottom = useRef<HTMLDivElement>(null),
    controller = useRef<AbortController | null>(null),
    previous = useRef<ChatData | undefined>(),
    savedId = useRef<string | undefined>(id),
    recognition = useRef<any>(null),
    session = useRef(0);
  useEffect(() => {
    if (models.length && !models.some((m) => m.id === model)) {
      setModel(
        models.find((m) => m.id === config.default_models?.split(",")[0])?.id ||
          models[0].id,
      );
    }
  }, [models, model, config.default_models]);
  useEffect(() => {
    let alive = true;
    session.current++;
    controller.current?.abort();
    recognition.current?.stop();
    savedId.current = id;
    setMessages([]);
    setChosenTools(searchParams.get("tool") ? [searchParams.get("tool")!] : []);
    setChosenSkills(
      searchParams.get("skill") ? [searchParams.get("skill")!] : [],
    );
    setFiles([]);
    setError("");
    setBusy(false);
    setTemporary(false);
    setDraft(searchParams.get("prompt") || "");
    previous.current = undefined;
    if (id) {
      setLoading(true);
      api
        .chat(id)
        .then((c) => {
          if (alive && c.chat) {
            previous.current = c.chat;
            setMessages(activeMessages(c.chat));
            setChosenSkills(c.chat.skill_ids || []);
            setChosenTools(c.chat.tool_ids || []);
            setModel(c.chat.models?.[0] || models[0]?.id || "");
            setEffort(
              validEffort(
                c.chat.params?.reasoning_effort ??
                  localStorage.getItem("kividas:effort"),
              ),
            );
          }
        })
        .catch((e) => {
          if (alive) setError(messageOf(e));
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    } else {
      setLoading(false);
    }
    return () => {
      alive = false;
      controller.current?.abort();
      recognition.current?.stop();
    };
  }, [id, searchParams.get("new")]);
  useEffect(() => {
    if (busy) bottom.current?.scrollIntoView({ block: "end" });
  }, [messages, busy]);
  useEffect(() => {
    if (input.current) {
      input.current.style.height = "auto";
      input.current.style.height = `${Math.min(input.current.scrollHeight, 220)}px`;
    }
  }, [draft]);
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowAttach(false);
        setShowModels(false);
        setCategory(null);
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  const guest = user?.email === "guest@guest.local";
  const selected = models.find((m) => m.id === model);
  async function send(e?: FormEvent) {
    e?.preventDefault();
    if (busy || uploading || (!draft.trim() && !files.length)) return;
    if (!user) {
      onLogin();
      return;
    }
    if (!model) {
      notify("Select an available model first.", true);
      return;
    }
    if (
      chosenSkills.length &&
      (skillsLoading ||
        skillsError ||
        selectedSkillIds(chosenSkills, skills).length !== chosenSkills.length)
    ) {
      notify(
        "A selected skill is unavailable. Wait for loading or remove it before sending.",
        true,
      );
      return;
    }
    if (
      chosenTools.length &&
      (toolsLoading ||
        toolsError ||
        chosenTools.some((id) => !connectors.some((t) => t.id === id)))
    ) {
      notify(
        "A selected connector is unavailable. Remove it before sending.",
        true,
      );
      return;
    }
    const generation = ++session.current;
    const keepHistory = !temporary && !guest;
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: draft.trim(),
      files: [...files],
      timestamp: Math.floor(Date.now() / 1000),
      done: true,
    };
    const assistant: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      model,
      timestamp: Math.floor(Date.now() / 1000),
      done: false,
    };
    const next = [...messages, userMessage, assistant];
    setMessages(next);
    setDraft("");
    setFiles([]);
    setError("");
    setBusy(true);
    setShowModels(false);
    setShowAttach(false);
    setCategory(null);
    const abort = new AbortController();
    controller.current = abort;
    try {
      if (keepHistory) {
        const data = {
          ...chatPayload(next, model, previous.current),
          params: reasoningParams(selected, effort),
          skill_ids: selectedSkillIds(chosenSkills, skills),
          tool_ids: chosenTools,
        };
        const saved = await api.saveChat(
          data,
          savedId.current,
          searchParams.get("project"),
        );
        if (session.current !== generation) return;
        savedId.current = saved.id;
        previous.current = data;
        onSaved();
      }
      await complete(
        {
          model,
          stream: true,
          messages: [
            ...(systemPrompt
              ? [{ role: "system", content: systemPrompt }]
              : []),
            ...next
              .filter((m) => m.id !== assistant.id)
              .map((m) => ({
                role: m.role,
                content: m.files?.some((f) => f.type === "image")
                  ? [
                      { type: "text", text: m.content },
                      ...m.files
                        .filter((f) => f.type === "image")
                        .map((f) => ({
                          type: "image_url",
                          image_url: { url: f.url },
                        })),
                    ]
                  : m.content,
              })),
          ],
          files: next
            .flatMap((m) => m.files ?? [])
            .filter((f) => f.type === "file"),
          features: { web_search: webSearch, memory },
          params: reasoningParams(selected, effort),
          skill_ids: selectedSkillIds(chosenSkills, skills),
          tool_ids: chosenTools,
          ...(keepHistory
            ? { chat_id: savedId.current, id: assistant.id }
            : {}),
        },
        abort.signal,
        (delta) => {
          if (session.current === generation) {
            assistant.content += delta;
            setMessages([...next]);
          }
        },
        (message) => {
          if (session.current === generation) {
            Object.assign(assistant, message);
            setMessages([...next]);
          }
        },
      );
      if (!assistant.content)
        throw new Error(
          "The model returned an empty response. Please try again.",
        );
    } catch (e) {
      if (
        session.current === generation &&
        !(e instanceof DOMException && e.name === "AbortError")
      ) {
        assistant.error = { content: messageOf(e) };
        setError(messageOf(e));
      }
    } finally {
      assistant.done = true;
      if (session.current === generation) {
        setMessages([...next]);
        setBusy(false);
        if (keepHistory && savedId.current) {
          try {
            const data = {
              ...chatPayload(next, model, previous.current),
              params: reasoningParams(selected, effort),
              skill_ids: selectedSkillIds(chosenSkills, skills),
              tool_ids: chosenTools,
            };
            await api.saveChat(data, savedId.current);
            previous.current = data;
            onSaved();
            if (!id && session.current === generation)
              navigate(`/c/${savedId.current}`, { replace: true });
          } catch (e) {
            notify(`Unable to save conversation: ${messageOf(e)}`, true);
          }
        }
      }
    }
  }
  async function attach(list: FileList | null) {
    if (!list) return;
    if (!user) {
      onLogin();
      return;
    }
    const uploadSession = session.current;
    setUploading(true);
    setShowAttach(false);
    try {
      const uploaded: Attachment[] = [];
      for (const f of Array.from(list)) {
        if (f.size > 25 * 1024 * 1024)
          throw new Error(`${f.name} exceeds the 25 MB limit.`);
        uploaded.push(await api.upload(f));
      }
      if (session.current === uploadSession)
        setFiles((f) => [...f, ...uploaded]);
    } catch (e) {
      notify(messageOf(e), true);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  function dictate() {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      notify("Voice dictation is not supported by this browser.", true);
      return;
    }
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const r = new SpeechRecognition();
    recognition.current = r;
    r.lang = navigator.language;
    r.interimResults = false;
    r.onresult = (e: any) => {
      setDraft((d) => `${d}${d ? " " : ""}${e.results[0][0].transcript}`);
    };
    r.onend = () => setListening(false);
    r.onerror = () => {
      setListening(false);
      notify("Unable to start dictation. Check microphone permission.", true);
    };
    r.start();
    setListening(true);
  }
  return (
    <div className={`chat-page ${messages.length ? "has-messages" : ""}`}>
      <header className="chat-header">
        <span>
          {messages.length
            ? previous.current?.title ||
              messages.find((m) => m.role === "user")?.content.slice(0, 55)
            : searchParams.get("project")
              ? "Project conversation"
              : ""}
        </span>
        <button
          className={`icon-btn ${temporary ? "active" : ""}`}
          disabled={!!messages.length || busy}
          aria-label={
            temporary ? "Turn off temporary chat" : "Use temporary chat"
          }
          title="Temporary chats are not saved"
          onClick={() => setTemporary((v) => !v)}
        >
          <Ghost size={19} />
        </button>
      </header>
      {loading ? (
        <Loading />
      ) : (
        <>
          <div className="chat-scroll">
            {!messages.length ? (
              <div className="greeting">
                <img className="brand-mark" src={new URL("../assets/claude.svg", import.meta.url).href} alt="Claude" />
                <h1>
                  {temporary
                    ? "A little space to think"
                    : user && !guest
                      ? `Back at it, ${user.name.split(" ")[0]}`
                      : "How can I help you today?"}
                </h1>
              </div>
            ) : (
              <div className="messages">
                {messages.map((m) => (
                  <article className={`message ${m.role}`} key={m.id}>
                    {m.role === "assistant" && <BrandMark small />}
                    <div className="message-body">
                      {m.files?.length ? (
                        <div className="message-files">
                          {m.files.map((f) =>
                            f.type === "image" ? (
                              <img key={f.id} src={f.url} alt={f.name} />
                            ) : (
                              <span key={f.id}>
                                <FileText size={16} />
                                {f.name}
                              </span>
                            ),
                          )}
                        </div>
                      ) : null}
                      {m.content ? (
                        <Markdown text={m.content} />
                      ) : m.role === "assistant" && busy ? (
                        <div className="thinking">
                          <span />
                          <span />
                          <span />
                        </div>
                      ) : null}
                      {m.error && <p className="error" role="alert">{typeof m.error === "string" ? m.error : m.error.content || m.error.message || "Unable to complete this response."}</p>}
                      {m.role === "assistant" && m.content && (
                        <div className="message-actions">
                          <button
                            className="icon-btn"
                            aria-label="Copy response"
                            onClick={() =>
                              navigator.clipboard
                                .writeText(m.content)
                                .then(() => notify("Response copied"))
                                .catch((e) => notify(messageOf(e), true))
                            }
                          >
                            <Copy size={15} />
                          </button>
                          <small>
                            {models.find((x) => x.id === m.model)?.name ||
                              m.model}
                          </small>
                        </div>
                      )}
                    </div>
                  </article>
                ))}
                <div ref={bottom} />
              </div>
            )}
          </div>
          <div className="composer-area">
            {error && <ErrorPanel error={error} />}
            <form className="composer" onSubmit={send}>
              <input
                ref={fileInput}
                type="file"
                hidden
                multiple
                onChange={(e) => void attach(e.target.files)}
              />
              {!!files.length && (
                <div className="attachment-list">
                  {files.map((f) => (
                    <span key={f.id}>
                      <Paperclip size={14} />
                      {f.name}
                      <button
                        type="button"
                        aria-label={`Remove ${f.name}`}
                        onClick={() =>
                          setFiles((list) => list.filter((x) => x.id !== f.id))
                        }
                      >
                        <X size={13} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {uploading && (
                <p className="small muted row">
                  <Loader2 className="spin" size={14} />
                  Preparing attachment…
                </p>
              )}
              {chosenTools.length > 0 && (
                <div className="selected-skills">
                  {chosenTools.map((id) => (
                    <button
                      type="button"
                      key={id}
                      onClick={() =>
                        setChosenTools((ids) => ids.filter((t) => t !== id))
                      }
                      aria-label={`Remove connector ${connectors.find((t) => t.id === id)?.name || id}`}
                    >
                      {connectors.find((t) => t.id === id)?.name ||
                        "Unavailable connector"}
                      <X size={13} />
                    </button>
                  ))}
                </div>
              )}
              {chosenSkills.length > 0 && (
                <div className="selected-skills">
                  {chosenSkills
                    .map(
                      (id) =>
                        skills.find((s) => s.id === id) || {
                          id,
                          name: skillsLoading
                            ? "Loading skill…"
                            : "Unavailable skill",
                        },
                    )
                    .map((s) => (
                      <button
                        type="button"
                        key={s.id}
                        onClick={() =>
                          setChosenSkills((ids) =>
                            ids.filter((id) => id !== s.id),
                          )
                        }
                        aria-label={`Remove skill ${s.name}`}
                      >
                        <Sparkles size={13} />
                        {s.name}
                        <X size={13} />
                      </button>
                    ))}
                </div>
              )}
              <textarea
                ref={input}
                value={draft}
                aria-label="Write your prompt"
                placeholder="How can I help you today?"
                rows={1}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="composer-toolbar">
                <div className="row">
                  <div className="popover-anchor">
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Add files and tools"
                      aria-expanded={showAttach}
                      onClick={() => {
                        setShowAttach((v) => !v);
                        setShowModels(false);
                      }}
                    >
                      <Plus size={20} />
                    </button>
                    {showAttach && (
                      <>
                        <button
                          type="button"
                          className="dismiss-layer"
                          aria-label="Close attachment menu"
                          onClick={() => setShowAttach(false)}
                        />
                        <div className="popover attachment-menu">
                          <button
                            type="button"
                            disabled={uploading}
                            onClick={() => fileInput.current?.click()}
                          >
                            <Paperclip size={17} />
                            Add files or photos
                          </button>
                          {config.features?.enable_web_search && (
                            <button
                              type="button"
                              aria-pressed={webSearch}
                              onClick={() => setWebSearch((v) => !v)}
                            >
                              <Globe size={17} />
                              Web search {webSearch && <Check size={15} />}
                            </button>
                          )}
                          <hr />
                          <div className="chat-skill-options">
                            {skills
                              .filter((s) => s.is_active)
                              .map((s) => (
                                <button
                                  key={s.id}
                                  type="button"
                                  aria-pressed={chosenSkills.includes(s.id)}
                                  onClick={() =>
                                    setChosenSkills((ids) =>
                                      ids.includes(s.id)
                                        ? ids.filter((id) => id !== s.id)
                                        : [...ids, s.id],
                                    )
                                  }
                                >
                                  <Sparkles size={15} />
                                  <span>{s.name}</span>
                                  {chosenSkills.includes(s.id) && (
                                    <Check size={15} />
                                  )}
                                </button>
                              ))}
                          </div>
                          {skillsError && (
                            <span className="popover-note">
                              Skills unavailable. Open Customize to retry.
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => navigate("/customize/skills")}
                          >
                            <Sparkles size={16} />
                            Manage skills
                          </button>
                          {connectors.map((t) => (
                            <button
                              type="button"
                              key={t.id}
                              aria-pressed={chosenTools.includes(t.id)}
                              onClick={() =>
                                setChosenTools((ids) =>
                                  ids.includes(t.id)
                                    ? ids.filter((id) => id !== t.id)
                                    : [...ids, t.id],
                                )
                              }
                            >
                              {t.name}
                              {chosenTools.includes(t.id) ? " ✓" : ""}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => navigate("/customize/connectors")}
                          >
                            Manage connectors
                          </button>
                          <button
                            type="button"
                            onClick={() => navigate("/customize/plugins")}
                          >
                            Add plugins
                          </button>
                          {config.features?.enable_memories && (
                            <button
                              type="button"
                              aria-pressed={memory}
                              onClick={() => setMemory((v) => !v)}
                            >
                              Memory {memory ? "✓" : ""}
                            </button>
                          )}
                          <span className="popover-note">
                            Images and documents · up to 25 MB
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                  <span className="mode-pill">Chat</span>
                  {webSearch && (
                    <span className="web-pill">
                      <Globe size={13} />
                      Search
                    </span>
                  )}
                </div>
                <div className="row toolbar-right">
                  <div className="popover-anchor">
                    <button
                      type="button"
                      className="model-trigger"
                      aria-label="Choose model"
                      aria-expanded={showModels}
                      disabled={busy}
                      onClick={() => {
                        setShowModels((v) => !v);
                        setShowAttach(false);
                      }}
                    >
                      <span>
                        {selected ? modelLabel(selected) : "Select model"}
                      </span>
                      {supportsEffort(selected) && (
                        <span className="trigger-effort">
                          {effortOptions.find((e) => e.value === effort)?.label}
                        </span>
                      )}
                    </button>
                    {showModels && (
                      <ModelPicker
                        models={models}
                        selected={model}
                        effort={effort}
                        onClose={() => setShowModels(false)}
                        onModel={(m) => {
                          setModel(m.id);
                          localStorage.setItem("kividas:model", m.id);
                          setShowModels(false);
                          input.current?.focus();
                        }}
                        onEffort={(value) => {
                          setEffort(value);
                          localStorage.setItem("kividas:effort", value);
                          setShowModels(false);
                          input.current?.focus();
                        }}
                      />
                    )}
                  </div>
                  <button
                    type="button"
                    className={`icon-btn ${listening ? "active" : ""}`}
                    aria-label={listening ? "Stop dictation" : "Dictate"}
                    onClick={dictate}
                  >
                    <Mic size={17} />
                  </button>
                  {busy ? (
                    <button
                      type="button"
                      className="send-button"
                      aria-label="Stop response"
                      onClick={() => controller.current?.abort()}
                    >
                      <Square size={15} fill="currentColor" />
                    </button>
                  ) : (
                    <button
                      className="send-button"
                      type="submit"
                      aria-label="Send message"
                      disabled={
                        uploading ||
                        (skillsLoading && chosenSkills.length > 0) ||
                        (!draft.trim() && !files.length) ||
                        !model
                      }
                    >
                      <ArrowUp size={19} />
                    </button>
                  )}
                </div>
              </div>
            </form>
            {!messages.length && (
              <div className="suggestion-area">
                {category === null ? (
                  <div className="prompt-categories">
                    {categories.map((c, i) => (
                      <button key={c.name} onClick={() => setCategory(i)}>
                        <c.icon size={16} />
                        {c.name}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="suggestion-panel">
                    <div className="row between">
                      <span className="muted small">
                        {categories[category].name}
                      </span>
                      <button
                        className="icon-btn"
                        aria-label="Close suggestions"
                        onClick={() => setCategory(null)}
                      >
                        <X size={16} />
                      </button>
                    </div>
                    {categories[category].prompts.map((p) => (
                      <button
                        key={p}
                        onClick={() => {
                          setDraft(p);
                          setCategory(null);
                          input.current?.focus();
                        }}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {messages.length > 0 && (
              <p className="composer-caption">
                Kividas can make mistakes. Check important information.
                {temporary || guest ? " This conversation is temporary." : ""}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
