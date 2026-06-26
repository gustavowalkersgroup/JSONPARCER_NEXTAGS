// Tipos centrais — contrato de toda a biblioteca.

export type ItemType = 'TEXT' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE' | 'TEMPLATE' | 'DELAY';

export type TransitionType =
  | 'intraCard'
  | 'interProduct'
  | 'textToMedia'
  | 'mediaToText'
  | 'textToText'
  | 'default';

// ---- Payload NexTags Messenger ----

export interface Button {
  type: 'web_url' | 'postback';
  title: string;
  url?: string;
  payload?: string;
}

export interface TemplateElement {
  title?: string;
  subtitle?: string;
  image_url?: string;
  buttons?: Button[];
}

export interface TemplatePayload {
  template_type: 'generic' | 'button';
  text?: string;
  image_aspect_ratio?: 'horizontal' | 'square';
  elements?: TemplateElement[];
  buttons?: Button[];
}

export interface Attachment {
  type: 'image' | 'video' | 'audio' | 'file' | 'template';
  payload: { url?: string } & Partial<TemplatePayload>;
}

export interface Message {
  text?: string;
  attachment?: Attachment;
}

export type MessageItem = { message: Message } | number;

export interface Action {
  action: string;
  [k: string]: unknown;
}

export interface NexTagsPayload {
  messages?: MessageItem[];
  actions?: Action[];
}

// ---- Diagnóstico / relatório ----

export type DiagnosticKind = 'repair' | 'warning' | 'error' | 'pending';

export interface Diagnostic {
  code: string;
  message: string;
  path?: string;
  detail?: unknown;
  fatal?: boolean;
}

export type Repair = Diagnostic;
export type Warning = Diagnostic;
export type ProcessError = Diagnostic;
export type Pending = Diagnostic;

export interface Stats {
  totalDurationSec: number;
  productCount: number;
  imageCount: number;
  messageCount: number;
  delayCount: number;
  repairCount: number;
  warningCount: number;
  errorCount: number;
  pendingCount: number;
}

export interface Report {
  repairs: Repair[];
  warnings: Warning[];
  errors: ProcessError[];
  pending: Pending[];
  stats: Stats;
}

export interface TimelineEntry {
  atSec: number;
  icon: string;
  kind: ItemType;
  label: string;
}

export interface Simulation {
  timeline: TimelineEntry[];
  render(): string;
  stats: Stats;
}

export interface Result {
  ok: boolean;
  data?: NexTagsPayload;
  report: Report;
  simulation?: Simulation;
}

// ---- Configuração ----

export type ImageProbe = (url: string) => Promise<{ contentType: string }>;

export type Handoff =
  | { action: 'send_flow'; flow_id: string }
  | { action: 'transfer_conversation_to'; value: 'human' }
  | null;

export interface MiddlewareOptions {
  image?: {
    strategy?: 'proxy' | 'detect-only';
    proxyBase?: string;
    stripQuery?: boolean;
    removeUnverifiable?: boolean;
    probe?: ImageProbe;
  };
  delays?: {
    intraCard?: number;
    interProduct?: number;
    bubble?: number;
    min?: number;
    max?: number;
    perTransition?: Partial<Record<TransitionType, number>>;
  };
  fallback?: {
    message?: string;
    handoff?: Handoff;
  };
  normalize?: {
    stripStandardMarkdown?: boolean;
    preserveWhatsappMarkup?: boolean;
    straightenQuotes?: boolean;
  };
  parser?: {
    useFallbackLibrary?: boolean;
    maxRepairPasses?: number;
  };
  simulate?: boolean;
  report?: { level?: 'silent' | 'error' | 'warn' | 'info' | 'debug' };
}

// Forma resolvida: todos os campos preenchidos (exceto probe, opcional por natureza).
export interface ResolvedOptions {
  image: {
    strategy: 'proxy' | 'detect-only';
    proxyBase: string;
    stripQuery: boolean;
    removeUnverifiable: boolean;
    probe?: ImageProbe;
  };
  delays: {
    intraCard: number;
    interProduct: number;
    bubble: number;
    min: number;
    max: number;
    perTransition: Partial<Record<TransitionType, number>>;
  };
  fallback: {
    message: string;
    handoff: Handoff;
  };
  normalize: {
    stripStandardMarkdown: boolean;
    preserveWhatsappMarkup: boolean;
    straightenQuotes: boolean;
  };
  parser: {
    useFallbackLibrary: boolean;
    maxRepairPasses: number;
  };
  simulate: boolean;
  report: { level: 'silent' | 'error' | 'warn' | 'info' | 'debug' };
}
