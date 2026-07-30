import {
	AlertCircle,
	ArrowLeft,
	Check,
	ChevronRight,
	Clock3,
	Inbox,
	LoaderCircle,
	Mail,
	Paperclip,
	RefreshCw,
	Search,
} from "lucide-react";
import {
	FormEvent,
	startTransition,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	Link,
	Outlet,
	useNavigate,
	useParams,
	useSearchParams,
} from "react-router";
import { ApiError, getDomains, getEmail, getEmails } from "./api";
import type { EmailDetail, EmailSummary } from "./types";

const POLL_INTERVAL_MS = 15_000;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function App() {
	return (
		<div className="app-shell">
			<header className="topbar">
				<Link className="brand" to="/" aria-label="Drift Inbox home">
					<span className="brand-mark"><Mail size={18} strokeWidth={2.2} /></span>
					<span>Drift Inbox</span>
				</Link>
				<span className="service-status"><span aria-hidden="true" /> Temporary mail</span>
			</header>
			<main><Outlet /></main>
		</div>
	);
}

export function HomeRoute() {
	return (
		<section className="home-view" aria-labelledby="home-title">
			<div className="home-content">
				<div className="home-icon"><Inbox size={24} /></div>
				<p className="eyebrow">Temporary inbox</p>
				<h1 id="home-title">Open an inbox</h1>
				<p className="home-copy">Enter a supported temporary email address to view its messages.</p>
				<AddressForm autoFocus />
				<DomainHint />
			</div>
		</section>
	);
}

function AddressForm({ initialValue = "", compact = false, autoFocus = false }) {
	const navigate = useNavigate();
	const [value, setValue] = useState(initialValue);
	const [error, setError] = useState("");

	useEffect(() => setValue(initialValue), [initialValue]);

	function submit(event: FormEvent) {
		event.preventDefault();
		const address = value.trim().toLowerCase();
		if (!emailPattern.test(address)) {
			setError("Enter a complete email address.");
			return;
		}
		setError("");
		navigate(`/inbox/${encodeURIComponent(address)}`);
	}

	return (
		<form className={`address-form${compact ? " is-compact" : ""}`} onSubmit={submit} noValidate>
			<label htmlFor={compact ? "switch-address" : "open-address"} className="sr-only">Email address</label>
			<div className="address-control">
				<Search size={18} aria-hidden="true" />
				<input
					id={compact ? "switch-address" : "open-address"}
					type="email"
					inputMode="email"
					autoComplete="email"
					autoCapitalize="none"
					spellCheck={false}
					placeholder="name@example.com"
					value={value}
					onChange={(event) => { setValue(event.target.value); setError(""); }}
					autoFocus={autoFocus}
					aria-describedby={error ? "address-error" : undefined}
					aria-invalid={Boolean(error)}
				/>
				<button type="submit">Open inbox <ChevronRight size={17} /></button>
			</div>
			{error && <p className="field-error" id="address-error"><AlertCircle size={14} /> {error}</p>}
		</form>
	);
}

function DomainHint() {
	const [domains, setDomains] = useState<string[]>([]);
	useEffect(() => {
		const controller = new AbortController();
		getDomains(controller.signal).then(setDomains).catch(() => undefined);
		return () => controller.abort();
	}, []);
	if (!domains.length) return null;
	return <p className="domain-hint">Supported: {domains.map((domain) => `@${domain}`).join(", ")}</p>;
}

export function InboxRoute() {
	const { address: routeAddress = "" } = useParams();
	const address = routeAddress.trim().toLowerCase();
	const [searchParams, setSearchParams] = useSearchParams();
	const selectedId = searchParams.get("message");
	const [domains, setDomains] = useState<string[] | null>(null);
	const [domainError, setDomainError] = useState("");
	const [emails, setEmails] = useState<EmailSummary[]>([]);
	const [listState, setListState] = useState<"loading" | "ready" | "error">("loading");
	const [listError, setListError] = useState("");
	const [refreshing, setRefreshing] = useState(false);
	const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
	const [detail, setDetail] = useState<EmailDetail | null>(null);
	const [detailState, setDetailState] = useState<"idle" | "loading" | "ready" | "error">("idle");
	const [detailError, setDetailError] = useState("");
	const listRequest = useRef(0);

	const validAddress = emailPattern.test(address);
	const domain = address.split("@")[1] || "";
	const unsupportedDomain = domains !== null && !domains.includes(domain);

	useEffect(() => {
		const controller = new AbortController();
		setDomainError("");
		getDomains(controller.signal)
			.then(setDomains)
			.catch((error: unknown) => {
				if (!(error instanceof DOMException && error.name === "AbortError")) {
					setDomainError(error instanceof Error ? error.message : "Could not load supported domains.");
				}
			});
		return () => controller.abort();
	}, []);

	const loadList = useCallback(async (background = false) => {
		if (!validAddress || unsupportedDomain) return;
		const requestId = ++listRequest.current;
		if (background) setRefreshing(true);
		else setListState("loading");
		try {
			const result = await getEmails(address);
			if (requestId !== listRequest.current) return;
			startTransition(() => {
				setEmails(result);
				setListState("ready");
				setListError("");
				setLastUpdated(new Date());
			});
		} catch (error) {
			if (requestId !== listRequest.current) return;
			if (error instanceof ApiError && error.supportedDomains) setDomains(error.supportedDomains);
			setListError(error instanceof Error ? error.message : "Could not load this inbox.");
			if (!background) setListState("error");
		} finally {
			if (requestId === listRequest.current) setRefreshing(false);
		}
	}, [address, unsupportedDomain, validAddress]);

	useEffect(() => {
		if (!validAddress || unsupportedDomain) return;
		void loadList(false);
		const timer = window.setInterval(() => void loadList(true), POLL_INTERVAL_MS);
		return () => { window.clearInterval(timer); listRequest.current += 1; };
	}, [loadList, validAddress, unsupportedDomain]);

	useEffect(() => {
		setDetail(null);
		setDetailError("");
		if (!selectedId) { setDetailState("idle"); return; }
		const controller = new AbortController();
		setDetailState("loading");
		getEmail(selectedId, controller.signal)
			.then((result) => { setDetail(result); setDetailState("ready"); })
			.catch((error: unknown) => {
				if (error instanceof DOMException && error.name === "AbortError") return;
				setDetailError(error instanceof Error ? error.message : "Could not load this message.");
				setDetailState("error");
			});
		return () => controller.abort();
	}, [selectedId]);

	function selectMessage(id: string | null) {
		if (id) setSearchParams({ message: id });
		else setSearchParams({});
	}

	if (!validAddress) return <InvalidInbox address={address} />;
	if (unsupportedDomain) return <UnsupportedInbox domain={domain} domains={domains} />;

	return (
		<section className={`inbox-view${selectedId ? " has-selection" : ""}`} aria-label={`Inbox for ${address}`}>
			<aside className="message-pane">
				<div className="inbox-controls">
					<AddressForm initialValue={address} compact />
					<div className="inbox-heading-row">
						<div><p className="eyebrow">Inbox</p><h1>{address}</h1></div>
						<button className="icon-button" type="button" onClick={() => void loadList(true)} disabled={refreshing} title="Refresh inbox" aria-label="Refresh inbox">
							<RefreshCw size={18} className={refreshing ? "spin" : ""} />
						</button>
					</div>
					<div className="inbox-meta" aria-live="polite">
						<span>{emails.length} {emails.length === 1 ? "message" : "messages"}</span>
						<span>{lastUpdated ? `Updated ${formatRelative(lastUpdated)}` : domainError || "Checking inbox"}</span>
					</div>
				</div>
			<MessageList state={listState} error={listError} emails={emails} selectedId={selectedId} onSelect={selectMessage} onRetry={() => void loadList(false)} />
			</aside>
			<section className="detail-pane" aria-label="Message detail">
				<MessageDetail id={selectedId} detail={detail} state={detailState} error={detailError} onBack={() => selectMessage(null)} />
			</section>
		</section>
	);
}

function MessageList({ state, error, emails, selectedId, onSelect, onRetry }: {
	state: "loading" | "ready" | "error";
	error: string;
	emails: EmailSummary[];
	selectedId: string | null;
	onSelect: (id: string) => void;
	onRetry: () => void;
}) {
	if (state === "loading") return <StatusPanel icon={<LoaderCircle className="spin" />} title="Loading messages" body="Checking this inbox now." />;
	if (state === "error") return <StatusPanel icon={<AlertCircle />} title="Inbox unavailable" body={error} action={<button type="button" onClick={onRetry}>Try again</button>} />;
	if (emails.length === 0) return <StatusPanel icon={<Inbox />} title="No messages yet" body="New mail will appear here automatically." />;

	return (
		<ul className="message-list" aria-label="Messages">
			{emails.map((email) => (
				<li key={email.id}>
					<button className={`message-item${selectedId === email.id ? " is-selected" : ""}`} type="button" onClick={() => onSelect(email.id)} aria-current={selectedId === email.id ? "true" : undefined}>
						<span className="sender-line"><strong>{displaySender(email.from_address)}</strong><time dateTime={new Date(email.received_at * 1000).toISOString()}>{formatMessageTime(email.received_at)}</time></span>
						<span className="subject-line">{email.subject?.trim() || "No subject"}</span>
						<span className="address-line">{email.from_address}{email.has_attachments && <span className="attachment-count"><Paperclip size={13} /> {email.attachment_count}</span>}</span>
					</button>
				</li>
			))}
		</ul>
	);
}

function MessageDetail({ id, detail, state, error, onBack }: {
	id: string | null;
	detail: EmailDetail | null;
	state: "idle" | "loading" | "ready" | "error";
	error: string;
	onBack: () => void;
}) {
	if (!id || state === "idle") return <StatusPanel icon={<Mail />} title="Select a message" body="Choose a message from the inbox to read it." />;
	if (state === "loading") return <StatusPanel icon={<LoaderCircle className="spin" />} title="Opening message" body="Loading the message content." back={onBack} />;
	if (state === "error" || !detail) return <StatusPanel icon={<AlertCircle />} title="Message unavailable" body={error} back={onBack} />;

	return (
		<article className="message-detail">
			<header className="detail-header">
				<button className="back-button" type="button" onClick={onBack}><ArrowLeft size={18} /> Inbox</button>
				<h2>{detail.subject?.trim() || "No subject"}</h2>
				<div className="message-facts">
					<div className="avatar" aria-hidden="true">{displaySender(detail.from_address).charAt(0).toUpperCase()}</div>
					<div className="sender-detail"><strong>{displaySender(detail.from_address)}</strong><span>{detail.from_address}</span><span>to {detail.to_address}</span></div>
					<time dateTime={new Date(detail.received_at * 1000).toISOString()}><Clock3 size={14} /> {formatFullDate(detail.received_at)}</time>
				</div>
				{detail.has_attachments && <div className="attachment-notice"><Paperclip size={15} /> {detail.attachment_count} {detail.attachment_count === 1 ? "attachment" : "attachments"}</div>}
			</header>
			<div className="message-body">
				{detail.html_content ? (
					<iframe title="Email content" sandbox="" referrerPolicy="no-referrer" srcDoc={detail.html_content} />
				) : detail.text_content ? (
					<pre>{detail.text_content}</pre>
				) : (
					<p className="empty-content">This message has no displayable content.</p>
				)}
			</div>
		</article>
	);
}

function StatusPanel({ icon, title, body, action, back }: { icon: React.ReactNode; title: string; body: string; action?: React.ReactNode; back?: () => void }) {
	return (
		<div className="status-panel">
			{back && <button className="back-button mobile-only" type="button" onClick={back}><ArrowLeft size={18} /> Inbox</button>}
			<div className="status-icon">{icon}</div><h2>{title}</h2><p>{body}</p>{action}
		</div>
	);
}

function InvalidInbox({ address }: { address: string }) {
	return <RouteError title="Invalid email address" body={address ? `“${address}” is not a complete email address.` : "The inbox URL does not contain an email address."} />;
}

function UnsupportedInbox({ domain, domains }: { domain: string; domains: string[] }) {
	return <RouteError title="Domain not supported" body={`@${domain} is not available. Supported domains: ${domains.map((item) => `@${item}`).join(", ")}.`} />;
}

function RouteError({ title, body }: { title: string; body: string }) {
	return (
		<section className="route-error"><div className="status-icon"><AlertCircle /></div><h1>{title}</h1><p>{body}</p><Link to="/"><ArrowLeft size={17} /> Open another inbox</Link></section>
	);
}

export function NotFoundRoute() {
	return <RouteError title="Page not found" body="This address does not point to an inbox page." />;
}

function displaySender(address: string) {
	const local = address.split("@")[0] || address;
	return local.replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatMessageTime(seconds: number) {
	const date = new Date(seconds * 1000);
	const now = new Date();
	if (date.toDateString() === now.toDateString()) return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
	return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function formatFullDate(seconds: number) {
	return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(seconds * 1000));
}

function formatRelative(date: Date) {
	const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
	if (seconds < 10) return "just now";
	if (seconds < 60) return `${seconds}s ago`;
	return `${Math.floor(seconds / 60)}m ago`;
}
