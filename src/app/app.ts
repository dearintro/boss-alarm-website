import { CommonModule } from '@angular/common';
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Subscription } from 'rxjs';
import { GoogleSheetService, SheetBossListItem } from './services/google-sheet.service';

type ServerType = 'own' | 'cross';

type AlertSoundType = 'tts' | 'audio';

interface AlertSoundOption {
  id: string;
  type: AlertSoundType;
  label: string;
  source?: string;
  disabled?: boolean;
  isUploaded?: boolean;
}

const BUILTIN_SOUND_FILES: ReadonlyArray<{ file: string; label?: string }> = [
  { file: 'งง.mp3' },
  { file: 'ทำเพื่ออะไร.mp3' },
  { file: 'ปริญญาใจ.mp3' },
  { file: 'ปาดขวา.mp3' },
  { file: 'พูดคำนี้.mp3' },
  { file: 'สวัสดีครับท่านสมาชิกชมรมคนชอบ-hee-made-with-Voicemod.mp3' },
  { file: 'อันดา.mp3' },
  { file: 'อ่ะจ๊ะเอ๋.mp3' },
  { file: 'เงี่ยนโว๊ย.ogg' }
];

const formatSoundLabel = (fileName: string): string => {
  const withoutExtension = fileName.replace(/\.[^.]+$/u, '');
  const normalized = withoutExtension.replace(/[-_]+/gu, ' ').trim();
  return `เสียง: ${normalized}`;
};

const buildBuiltinSoundOptions = (): AlertSoundOption[] =>
  BUILTIN_SOUND_FILES.map((item, index) => ({
    id: `builtin-${index}`,
    type: 'audio',
    label: item.label ?? formatSoundLabel(item.file),
    source: `sounds/${item.file}`
  }));

interface BossEntry {
  id: string;
  name: string;
  map: string;
  clan: string;
  serverType: ServerType;
  spawnTime: Date;
  spawnLabel: string;
  alertTime: Date;
  alertLabel: string;
  createdOrder: number;
  alertTriggered: boolean;
  triggeredAt: Date | null;
  historyLoggedAt?: Date | null;
  leadMinutes: number;
  sourceKey?: string | null;
  sheetSignature?: string | null;
}

interface BossHistoryEntry {
  id: string;
  name: string;
  map: string;
  clan: string;
  serverType: ServerType;
  spawnTime: Date;
  spawnLabel: string;
  alertTime: Date;
  alertLabel: string;
  triggeredAt: Date;
}

interface ParseResult {
  entries: BossEntry[];
  errors: string[];
}

const MINUTE_MS = 60_000;
const DEFAULT_LEAD_MINUTES = 3;
const DISPLAY_FORMAT = new Intl.DateTimeFormat('th-TH', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnDestroy {
  private readonly fb = new FormBuilder();
  private readonly entries: BossEntry[] = [];
  private readonly historyLog: BossHistoryEntry[] = [];
  private orderCounter = 0;
  private readonly alertTimers = new Map<string, number>();
  private readonly pendingAlertIds: string[] = [];
  private readonly removalTimers = new Map<string, number>();
  private nowTickerId: number | null = null;
  private countdownIntervalId: number | null = null;
  private autoStopTimeoutId: number | null = null;
  private audioContext: AudioContext | null = null;
  private activeOscillator: OscillatorNode | null = null;
  private audioGain: GainNode | null = null;
  private speechVoice: SpeechSynthesisVoice | null = null;
  private speechVoicesCleanup: (() => void) | null = null;
  private activeUtterance: SpeechSynthesisUtterance | null = null;
  private activeSpeechEntryId: string | null = null;
  private activeAudioElement: HTMLAudioElement | null = null;
  private previewAudioElement: HTMLAudioElement | null = null;
  private previewUtterance: SpeechSynthesisUtterance | null = null;
  private previewTimeoutId: number | null = null;
  private readonly uploadedSoundUrls = new Map<string, string>();
  private readonly builtinAudioOptions: readonly AlertSoundOption[] = buildBuiltinSoundOptions();
  private readonly uploadedSoundOptions = signal<AlertSoundOption[]>([]);
  private readonly deleteConfirmationState = signal<{ id: string; name: string } | null>(null);
  private readonly sheetService = inject(GoogleSheetService);
  private sheetSyncIntervalId: number | null = null;
  private sheetSyncSubscription: Subscription | null = null;
  private readonly sheetSyncIntervalMs = 30_000;
  private readonly sheetCacheKey = 'boss-alarm.sheet-cache';
  protected readonly sheetSyncError = signal<string | null>(null);

  protected readonly serverOptions: ReadonlyArray<{ value: ServerType; label: string }> = [
    { value: 'own', label: 'บอสในเซิฟเวอร์ตัวเอง' },
    { value: 'cross', label: 'บอสข้ามเซิฟเวอร์' }
  ];

  protected readonly bossForm = this.fb.group({
    rawInput: ['', Validators.required],
    serverType: [this.serverOptions[0]!.value, Validators.required]
  });

  protected readonly bosses = signal<readonly BossEntry[]>([]);
  protected readonly parsingErrors = signal<string[]>([]);
  protected readonly now = signal(new Date());
  protected readonly activeAlert = signal<BossEntry | null>(null);
  protected readonly countdownSeconds = signal(0);
  protected readonly volumePercent = signal(70);
  protected readonly speechAvailable = signal(false);
  protected readonly speechVoiceLabel = signal('กำลังเตรียมเสียง...');
  protected readonly uploadError = signal<string | null>(null);
  protected readonly selectedAlertSoundId = signal<string>('tts-default');
  protected readonly isTestingAlertSound = signal(false);
  protected readonly soundTestMessage = signal<string | null>(null);
  protected readonly alertSoundOptions = computed<readonly AlertSoundOption[]>(() => {
    const voiceLabel = this.speechVoiceLabel();
    const isSpeechReady = this.speechAvailable();
    const ttsOption: AlertSoundOption = {
      id: 'tts-default',
      type: 'tts',
      label: `เสียงพูด (${voiceLabel})`,
      disabled: !isSpeechReady
    };

    return [ttsOption, ...this.builtinAudioOptions, ...this.uploadedSoundOptions()];
  });
  protected readonly uploadedSounds = computed(() => this.uploadedSoundOptions());
  protected readonly history = signal<readonly BossHistoryEntry[]>([]);
  protected readonly activeTab = signal<'upcoming' | 'history'>('upcoming');
  protected readonly clanFilter = signal<'all' | string>('all');
  protected readonly adjustOptions = [0, 1, 2, DEFAULT_LEAD_MINUTES];
  protected readonly defaultLeadMinutes = DEFAULT_LEAD_MINUTES;
  protected readonly deleteConfirmation = computed(() => this.deleteConfirmationState());
  protected readonly clanOptions = computed(() => {
    const clans = new Set<string>();
    for (const entry of this.bosses()) {
      clans.add(entry.clan);
    }
    for (const record of this.history()) {
      clans.add(record.clan);
    }
    return Array.from(clans).sort((a, b) => a.localeCompare(b, 'th-TH'));
  });

  constructor() {
    this.startNowTicker();
    this.initSpeechSynthesis();
    this.restoreSheetEntriesFromCache();
    this.startSheetSync();
    console.log('test');
  }

  private initSpeechSynthesis(): void {
    if (this.speechVoicesCleanup) {
      this.speechVoicesCleanup();
      this.speechVoicesCleanup = null;
    }

    if (typeof window === 'undefined' || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      this.speechAvailable.set(false);
      this.speechVoiceLabel.set('ระบบนี้ไม่รองรับการอ่านข้อความเป็นเสียง');
      this.speechVoice = null;
      this.ensureSelectedAlertSound();
      return;
    }

    this.speechAvailable.set(true);
    const synth = window.speechSynthesis;

    const updateVoice = () => {
      const voices = synth.getVoices();
      if (!voices.length) {
        this.speechVoice = null;
        this.speechVoiceLabel.set('กำลังเตรียมเสียงพูด...');
        return;
      }

      const lowerLang = (voice: SpeechSynthesisVoice) => (voice.lang ?? '').toLowerCase();
      const desiredVoiceName = 'microsoft pattara';
      const pattaraVoice = voices.find((voice) => (voice.name ?? '').toLowerCase().includes(desiredVoiceName)) ?? null;
      const thaiVoice = voices.find((voice) => lowerLang(voice).startsWith('th')) ?? null;
      const defaultVoice = voices.find((voice) => voice.default) ?? voices[0] ?? null;

      this.speechVoice = pattaraVoice ?? thaiVoice ?? defaultVoice;

      if (this.speechVoice) {
        const voiceName = this.speechVoice.name ?? 'เสียงเริ่มต้นของระบบ';
        const langSuffix = this.speechVoice.lang ? ` (${this.speechVoice.lang})` : '';
        this.speechVoiceLabel.set(`${voiceName}${langSuffix}`);
      } else {
        this.speechVoiceLabel.set('ใช้เสียงเริ่มต้นของระบบ');
      }

      this.ensureSelectedAlertSound();
    };

    updateVoice();

    const listener = () => updateVoice();
    synth.addEventListener('voiceschanged', listener);
    this.speechVoicesCleanup = () => synth.removeEventListener('voiceschanged', listener);
  }

  submitBosses(): void {
    if (this.bossForm.invalid) {
      this.bossForm.markAllAsTouched();
      return;
    }

    const rawInput = (this.bossForm.value.rawInput ?? '').trim();
    const serverType = this.bossForm.value.serverType as ServerType | null;

    if (!rawInput || !serverType) {
      return;
    }

    const { entries, errors } = this.parseBossLines(rawInput, serverType);

    this.parsingErrors.set(errors);

    if (!entries.length) {
      return;
    }

    for (const entry of entries) {
      this.entries.push(entry);
    }

    this.recalculateAlertTimes();
    this.refreshBossesSignal();
    this.scheduleAlerts();
    this.bossForm.patchValue({ rawInput: '' });
  }

  protected serverLabel(type: ServerType): string {
    return type === 'own' ? 'เซิฟเวอร์ตัวเอง' : 'ข้ามเซิฟเวอร์';
  }

  protected onVolumeInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    if (!target) {
      return;
    }
    const value = Number(target.value);
    if (Number.isNaN(value)) {
      return;
    }
    this.updateVolumePercent(value);
  }

  protected onAlertSoundSelect(event: Event): void {
    const select = event.target as HTMLSelectElement | null;
    if (!select) {
      return;
    }

    this.selectedAlertSoundId.set(select.value);
    this.uploadError.set(null);
    this.ensureSelectedAlertSound();
  }

  protected onAlertSoundUpload(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    if (!input || !input.files || input.files.length === 0) {
      return;
    }

    const file = input.files[0]!;

    if (!this.isMp3File(file)) {
      this.uploadError.set('รองรับเฉพาะไฟล์เสียง .mp3 เท่านั้น');
      input.value = '';
      return;
    }

    this.uploadError.set(null);

    const url = URL.createObjectURL(file);
    const labelBase = file.name.replace(/\.[^.]+$/u, '');
    const option: AlertSoundOption = {
      id: `uploaded-${this.generateId()}`,
      type: 'audio',
      label: `อัปโหลด: ${labelBase}`,
      source: url,
      isUploaded: true
    };

    this.uploadedSoundOptions.update((items) => [...items, option]);
    this.uploadedSoundUrls.set(option.id, url);
    this.selectedAlertSoundId.set(option.id);
    this.ensureSelectedAlertSound();
    input.value = '';
  }

  protected testAlertSound(): void {
    if (this.activeAlert()) {
      return;
    }

    if (this.isTestingAlertSound()) {
      this.stopPreviewOutputs();
      this.soundTestMessage.set(null);
      return;
    }

    const option = this.ensureSelectedAlertSound();
    if (!option) {
      this.soundTestMessage.set('กรุณาเลือกเสียงแจ้งเตือนก่อน');
      return;
    }

    this.soundTestMessage.set(null);
    this.stopPreviewOutputs();

    if (option.type === 'audio' && option.source) {
      this.startPreviewAudio(option.source);
      return;
    }

    if (option.type === 'tts') {
      if (this.startPreviewSpeech()) {
        return;
      }
      this.soundTestMessage.set('ไม่สามารถทดสอบเสียงพูดได้บนอุปกรณ์นี้');
      return;
    }

    this.soundTestMessage.set('ไม่สามารถทดสอบเสียงนี้ได้');
  }

  protected removeUploadedSound(soundId: string): void {
    let selectionChanged = false;
    if (this.selectedAlertSoundId() === soundId) {
      selectionChanged = true;
    }

    this.uploadedSoundOptions.update((items) => items.filter((item) => item.id !== soundId));
    this.revokeUploadedSoundUrl(soundId);

    if (selectionChanged) {
      this.ensureSelectedAlertSound();
    }
  }

  protected selectTab(tab: 'upcoming' | 'history'): void {
    this.activeTab.set(tab);
  }

  protected onClanSelect(event: Event): void {
    const select = event.target as HTMLSelectElement | null;
    if (!select) {
      return;
    }
    const value = select.value as 'all' | string;
    if (this.clanFilter() === value) {
      return;
    }
    this.clanFilter.set(value);
    this.handleClanFilterChange();
  }

  protected filteredBosses(): readonly BossEntry[] {
    const filter = this.clanFilter();
    if (filter === 'all') {
      return this.bosses();
    }
    return this.bosses().filter((entry) => entry.clan === filter);
  }

  protected filteredHistory(): readonly BossHistoryEntry[] {
    return this.history();
  }

  private handleClanFilterChange(): void {
    this.prunePendingAlerts();

    const active = this.activeAlert();
    if (active && !this.shouldAlertFor(active)) {
      this.stopAlert();
    }

    this.scheduleAlerts();
  }

  private prunePendingAlerts(): void {
    for (let index = this.pendingAlertIds.length - 1; index >= 0; index--) {
      const id = this.pendingAlertIds[index];
      const entry = this.entries.find((item) => item.id === id);
      if (!entry || entry.alertTriggered || !this.shouldAlertFor(entry)) {
        this.pendingAlertIds.splice(index, 1);
      }
    }
  }

  private shouldAlertFor(entry: BossEntry): boolean {
    const filter = this.clanFilter();
    return filter === 'all' || entry.clan === filter;
  }

  protected isAdjustDisabled(entry: BossEntry, minutes: number): boolean {
    if (entry.alertTriggered) {
      return true;
    }

    const desiredAlertTime = entry.spawnTime.getTime() - Math.max(0, Math.floor(minutes)) * MINUTE_MS;
    return desiredAlertTime <= this.now().getTime();
  }

  protected adjustAlertLead(entry: BossEntry, minutes: number, event?: Event): void {
    if (entry.alertTriggered) {
      return;
    }

    const previousAlertTimeMs = entry.alertTime.getTime();
    const previousLeadMinutes = entry.leadMinutes;
    const nowMs = Date.now();

    const sanitized = Math.max(0, Math.floor(minutes));
    if (entry.leadMinutes === sanitized) {
      return;
    }

    entry.leadMinutes = sanitized;

    let alertTimeMs = entry.spawnTime.getTime() - sanitized * MINUTE_MS;

    const isReducingLead = sanitized < previousLeadMinutes;
    const timeUntilPreviousAlert = previousAlertTimeMs - nowMs;
    if (
      isReducingLead &&
      alertTimeMs > previousAlertTimeMs &&
      timeUntilPreviousAlert >= 0 &&
      timeUntilPreviousAlert <= 60_000
    ) {
      alertTimeMs = nowMs;
    }

    const alertDate = new Date(alertTimeMs);
    entry.alertTime = alertDate;
    entry.alertLabel = DISPLAY_FORMAT.format(alertDate);

    this.clearTimerFor(entry.id);
    this.removeFromQueue(entry.id);
    this.sortEntries();
    this.refreshBossesSignal();
    this.scheduleAlerts();

    const button = event?.currentTarget as HTMLButtonElement | null;
    if (button) {
      queueMicrotask(() => button.focus());
    }
  }

  protected timeUntilSpawn(entry: BossEntry): string {
    const diffMs = entry.spawnTime.getTime() - this.now().getTime();

    if (diffMs > 0) {
      const totalSeconds = Math.floor(diffMs / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;

      if (minutes > 0) {
        return `${minutes} นาที ${seconds.toString().padStart(2, '0')} วิ`;
      }

      return `${seconds} วิ`;
    }

    const overdueMs = Math.abs(diffMs);
    if (overdueMs < 1000) {
      return 'ครบเวลาแล้ว';
    }

    const totalSeconds = Math.floor(overdueMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (minutes > 0) {
      return `เลยเวลา ${minutes} นาที ${seconds.toString().padStart(2, '0')} วิ`;
    }

    return `เลยเวลา ${seconds} วิ`;
  }

  protected bossStatus(entry: BossEntry): string {
    if (entry.alertTriggered || this.now().getTime() >= entry.spawnTime.getTime()) {
      return 'เกิดแล้ว';
    }
    return 'ยังไม่เกิด';
  }

  protected async copyBoss(entry: BossEntry): Promise<void> {
    const serverText = entry.serverType === 'cross' ? 'Cross Server' : 'B10';
    const text = `${entry.name} ${entry.clan} ${serverText} ${entry.spawnLabel}`;

    if (typeof navigator !== 'undefined' && navigator.clipboard && 'writeText' in navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch {
        // continue to fallback
      }
    }

    if (typeof document === 'undefined') {
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      document.execCommand('copy');
    } catch {
      // ignore fallback errors
    } finally {
      document.body.removeChild(textarea);
    }
  }

  protected requestBossRemoval(id: string): void {
    const info = this.findDeletionInfo(id);
    this.deleteConfirmationState.set(info);
  }

  protected confirmBossRemoval(): void {
    const pending = this.deleteConfirmationState();
    if (!pending) {
      return;
    }
    this.deleteConfirmationState.set(null);
    this.removeBoss(pending.id);
  }

  protected cancelBossRemoval(): void {
    this.deleteConfirmationState.set(null);
  }

  private findDeletionInfo(id: string): { id: string; name: string } | null {
    const entry = this.entries.find((item) => item.id === id);
    if (!entry) {
      return null;
    }
    return { id: entry.id, name: entry.name };
  }

  private clearRemovalTimer(id: string): void {
    const timerId = this.removalTimers.get(id);
    if (timerId !== undefined) {
      if (typeof window !== 'undefined') {
        window.clearTimeout(timerId);
      }
      this.removalTimers.delete(id);
    }
  }

  private clearRemovalTimers(): void {
    if (typeof window === 'undefined') {
      this.removalTimers.clear();
      return;
    }

    for (const timerId of this.removalTimers.values()) {
      window.clearTimeout(timerId);
    }
    this.removalTimers.clear();
  }

  private removeBoss(id: string): void {
    const index = this.entries.findIndex((entry) => entry.id === id);
    if (index === -1) {
      return;
    }

    if (this.activeAlert()?.id === id) {
      this.stopAlert();
    }

    this.clearRemovalTimer(id);
    this.clearTimerFor(id);
    this.removeFromQueue(id);
    this.entries.splice(index, 1);
    this.recalculateAlertTimes();
    this.refreshBossesSignal();
    this.scheduleAlerts();
  }

  ngOnDestroy(): void {
    this.cleanupSheetSync();
    this.clearAlertTimers();
    this.clearRemovalTimers();
    this.clearCountdown();
    this.stopPreviewOutputs();
    if (typeof window !== 'undefined') {
      if (this.nowTickerId !== null) {
        window.clearInterval(this.nowTickerId);
      }
    }
    this.stopAlarmOutputs(true);
    this.revokeAllUploadedSoundUrls();
    if (this.speechVoicesCleanup) {
      this.speechVoicesCleanup();
      this.speechVoicesCleanup = null;
    }
    if (this.audioContext) {
      void this.audioContext.close();
      this.audioContext = null;
    }
  }

  private parseBossLines(raw: string, serverType: ServerType): ParseResult {
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const entries: BossEntry[] = [];
    const errors: string[] = [];

    const pattern = /^(?<time>\d{1,2}:\d{2})\s*-\s*(?<name>.+?)\s*\((?<map>[^()]+)\)\s*\(ของ\s*(?<clan>[^)]+)\)\s*$/u;

    lines.forEach((line, index) => {
      const cleaned = line.replaceAll('**', '').replace('🕐', '').trim();

      const match = cleaned.match(pattern);
      if (!match || !match.groups) {
        errors.push(`แถวที่ ${index + 1}: รูปแบบไม่ถูกต้อง`);
        return;
      }

  const spawnLabel = this.normalizeTime(match.groups['time'] ?? '00:00');
  const name = (match.groups['name'] ?? '').trim().replace(/\s*-\s*/u, ' - ');
  const map = (match.groups['map'] ?? '').trim();
  const clan = (match.groups['clan'] ?? '').trim();

      if (!name || !map || !clan) {
        errors.push(`แถวที่ ${index + 1}: ข้อมูลไม่ครบถ้วน`);
        return;
      }

      const spawnTime = this.computeNextOccurrence(spawnLabel);

      entries.push({
        id: this.generateId(),
        name,
        map,
        clan,
        serverType,
        spawnTime,
        spawnLabel,
  alertTime: new Date(spawnTime.getTime() - DEFAULT_LEAD_MINUTES * MINUTE_MS),
        alertLabel: '',
        createdOrder: this.orderCounter++,
        alertTriggered: false,
        triggeredAt: null,
        leadMinutes: DEFAULT_LEAD_MINUTES
      });
    });

    return { entries, errors };
  }

  private recalculateAlertTimes(): void {
    for (const entry of this.entries) {
      if (entry.alertTriggered) {
        continue;
      }

      const leadMinutes = Math.max(0, Math.floor(entry.leadMinutes));
      const alertTimeMs = entry.spawnTime.getTime() - leadMinutes * MINUTE_MS;
      const alertDate = new Date(alertTimeMs);
      entry.alertTime = alertDate;
      entry.alertLabel = DISPLAY_FORMAT.format(alertDate);
    }

    // Keep entries sorted by alert time then by creation for display
    this.sortEntries();
  }

  private sortEntries(): void {
    this.entries.sort((a, b) => {
      if (a.alertTriggered !== b.alertTriggered) {
        return a.alertTriggered ? 1 : -1;
      }
      if (a.alertTime.getTime() === b.alertTime.getTime()) {
        return a.createdOrder - b.createdOrder;
      }
      return a.alertTime.getTime() - b.alertTime.getTime();
    });
  }

  private refreshBossesSignal(): void {
    this.bosses.set([...this.entries]);
    this.ensureValidClanFilter();
  }

  private startSheetSync(): void {
    this.fetchSheetEntries();
    if (typeof window === 'undefined') {
      return;
    }
    this.sheetSyncIntervalId = window.setInterval(() => {
      this.fetchSheetEntries();
    }, this.sheetSyncIntervalMs);
  }

  private fetchSheetEntries(): void {
    this.sheetSyncSubscription?.unsubscribe();
    this.sheetSyncSubscription = this.sheetService.fetchBossList().subscribe({
      next: (items) => {
        this.sheetSyncError.set(null);
        this.mergeSheetEntries(items);
      },
      error: (error) => {
        const message = error?.message ?? 'ซิงก์ข้อมูลจาก Google Sheet ไม่สำเร็จ';
        this.sheetSyncError.set(message);
      }
    });
  }

  private cleanupSheetSync(): void {
    this.sheetSyncSubscription?.unsubscribe();
    this.sheetSyncSubscription = null;
    if (typeof window !== 'undefined' && this.sheetSyncIntervalId !== null) {
      window.clearInterval(this.sheetSyncIntervalId);
      this.sheetSyncIntervalId = null;
    }
  }

  private mergeSheetEntries(items: SheetBossListItem[], options?: { skipCacheWrite?: boolean }): void {
    const desiredKeys = new Set<string>();

    for (const item of items ?? []) {
      if (!item || !item.bossName || !item.formattedTime) {
        continue;
      }
      const sourceKey = this.buildSheetSourceKey(item);
      const sheetSignature = this.buildSheetSignature(item);
      desiredKeys.add(sourceKey);
      let existing = this.entries.find((entry) => entry.sourceKey === sourceKey);
      if (!existing && sheetSignature) {
        existing = this.findEntryBySheetSignature(sheetSignature);
        if (existing) {
          existing.sourceKey = sourceKey;
        }
      }
      if (existing) {
        this.updateEntryFromSheet(existing, item, sheetSignature);
      } else {
        const newEntry = this.createEntryFromSheet(item, sourceKey, sheetSignature);
        this.entries.push(newEntry);
      }
    }

    this.pruneSheetEntries(desiredKeys);
    this.sortEntries();
    this.refreshBossesSignal();
    this.scheduleAlerts();
    if (!options?.skipCacheWrite) {
      this.persistSheetCache(items);
    }
  }

  private restoreSheetEntriesFromCache(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    const cachedItems = this.readCachedSheetItems();
    if (!cachedItems.length) {
      return;
    }

    this.mergeSheetEntries(cachedItems, { skipCacheWrite: true });
  }

  private readCachedSheetItems(): SheetBossListItem[] {
    try {
      const raw = window.localStorage.getItem(this.sheetCacheKey);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }
      const validItems: SheetBossListItem[] = [];
      for (const item of parsed) {
        if (this.isValidSheetItem(item)) {
          validItems.push({
            bossName: item.bossName,
            owner: item.owner ?? '',
            formattedTime: item.formattedTime
          });
        }
      }
      return validItems;
    } catch (error) {
      console.warn('Failed to read sheet cache', error);
      return [];
    }
  }

  private persistSheetCache(items: SheetBossListItem[]): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    try {
      const payload = (items ?? []).map((item) => ({
        bossName: item.bossName,
        owner: item.owner ?? '',
        formattedTime: item.formattedTime
      }));
      window.localStorage.setItem(this.sheetCacheKey, JSON.stringify(payload));
    } catch (error) {
      console.warn('Failed to persist sheet cache', error);
    }
  }

  private isValidSheetItem(value: unknown): value is SheetBossListItem {
    if (!value || typeof value !== 'object') {
      return false;
    }
    const candidate = value as Record<string, unknown>;
    return typeof candidate['bossName'] === 'string' && typeof candidate['formattedTime'] === 'string';
  }

  private pruneSheetEntries(validKeys: Set<string>): void {
    for (let index = this.entries.length - 1; index >= 0; index--) {
      const entry = this.entries[index];
      if (!entry.sourceKey) {
        continue;
      }
      if (!validKeys.has(entry.sourceKey)) {
        if (this.activeAlert()?.id === entry.id) {
          this.stopAlert();
        }
        this.clearRemovalTimer(entry.id);
        this.clearTimerFor(entry.id);
        this.removeFromQueue(entry.id);
        this.entries.splice(index, 1);
      }
    }
  }

  private createEntryFromSheet(item: SheetBossListItem, sourceKey: string, sheetSignature: string | null): BossEntry {
    const { name, map } = this.extractNameAndMap(item.bossName);
    const clan = (item.owner ?? '').trim() || 'ไม่ระบุ';
    const spawnTime = this.computeNextOccurrence(item.formattedTime);
    const spawnLabel = DISPLAY_FORMAT.format(spawnTime);
    const leadMinutes = DEFAULT_LEAD_MINUTES;
    const alertTime = new Date(spawnTime.getTime() - leadMinutes * MINUTE_MS);
    const alertLabel = DISPLAY_FORMAT.format(alertTime);

    return {
      id: this.generateId(),
      name,
      map,
      clan,
      serverType: 'own',
      spawnTime,
      spawnLabel,
      alertTime,
      alertLabel,
      createdOrder: this.orderCounter++,
      alertTriggered: false,
      triggeredAt: null,
      historyLoggedAt: null,
      leadMinutes,
      sourceKey,
      sheetSignature: sheetSignature ?? null
    };
  }

  private updateEntryFromSheet(target: BossEntry, item: SheetBossListItem, sheetSignature: string | null): void {
    if (this.isEntryLocked(target)) {
      if (sheetSignature) {
        target.sheetSignature = sheetSignature;
      }
      return;
    }

    const { name, map } = this.extractNameAndMap(item.bossName);
    const clan = (item.owner ?? '').trim() || 'ไม่ระบุ';
    const spawnTime = this.computeNextOccurrence(item.formattedTime);
    const spawnLabel = DISPLAY_FORMAT.format(spawnTime);

    const spawnChanged = target.spawnTime.getTime() !== spawnTime.getTime();
    const detailsChanged = target.name !== name || target.map !== map || target.clan !== clan;
    if (!spawnChanged && !detailsChanged) {
      return;
    }

    target.name = name;
    target.map = map;
    target.clan = clan;
    target.spawnTime = spawnTime;
    target.spawnLabel = spawnLabel;
    if (sheetSignature) {
      target.sheetSignature = sheetSignature;
    }

    const leadMinutes = Math.max(0, Math.floor(target.leadMinutes ?? DEFAULT_LEAD_MINUTES));
    const alertTime = new Date(spawnTime.getTime() - leadMinutes * MINUTE_MS);
    target.alertTime = alertTime;
    target.alertLabel = DISPLAY_FORMAT.format(alertTime);

    if (spawnChanged) {
      target.alertTriggered = false;
      target.triggeredAt = null;
      target.historyLoggedAt = null;
      this.clearRemovalTimer(target.id);
    }

    this.clearTimerFor(target.id);
    this.removeFromQueue(target.id);
  }

  private buildSheetSourceKey(item: SheetBossListItem): string {
    return `${item.formattedTime}|${item.bossName}|${item.owner ?? ''}`;
  }

  private buildSheetSignature(item: SheetBossListItem): string | null {
    if (!item.bossName || !item.formattedTime) {
      return null;
    }
    const time = this.normalizeTime(item.formattedTime);
    const normalizedName = this.normalizeSheetName(item.bossName);
    if (!normalizedName) {
      return null;
    }
    return `${time}|${normalizedName}`;
  }

  private normalizeSheetName(value: string): string {
    return value
      .replace(/\*/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  private findEntryBySheetSignature(signature: string | null): BossEntry | undefined {
    if (!signature) {
      return undefined;
    }
    return this.entries.find((entry) => entry.sheetSignature === signature);
  }

  private isEntryLocked(entry: BossEntry): boolean {
    const active = this.activeAlert();
    if (active && active.id === entry.id) {
      return true;
    }
    if (!entry.triggeredAt) {
      return false;
    }
    const now = Date.now();
    const triggeredAtMs = entry.triggeredAt.getTime();
    return now - triggeredAtMs < 2 * MINUTE_MS;
  }

  private extractNameAndMap(rawName: string): { name: string; map: string } {
    const sanitized = (rawName ?? '').replace(/\*/g, '').trim();
    if (!sanitized) {
      return { name: 'ไม่ทราบชื่อ', map: 'ไม่ระบุ' };
    }

    const lastOpen = sanitized.lastIndexOf('(');
    const lastClose = sanitized.lastIndexOf(')');
    if (lastOpen !== -1 && lastClose > lastOpen) {
      const map = sanitized.slice(lastOpen + 1, lastClose).trim();
      const base = sanitized.slice(0, lastOpen).replace(/[\-\s]+$/u, '').trim();
      return {
        name: base || sanitized,
        map: map || 'ไม่ระบุ'
      };
    }

    return { name: sanitized, map: 'ไม่ระบุ' };
  }

  private scheduleAlerts(): void {
    if (typeof window === 'undefined') {
      return;
    }

    this.clearAlertTimers();

    for (let i = this.pendingAlertIds.length - 1; i >= 0; i--) {
      const queuedId = this.pendingAlertIds[i];
      const exists = this.entries.some((entry) => entry.id === queuedId);
      if (!exists) {
        this.pendingAlertIds.splice(i, 1);
      }
    }

    const now = Date.now();

    for (const entry of this.entries) {
      if (entry.alertTriggered) {
        continue;
      }
      if (!this.shouldAlertFor(entry)) {
        continue;
      }
      if (this.isEntryLocked(entry) || this.pendingAlertIds.includes(entry.id)) {
        continue;
      }
      const delay = entry.alertTime.getTime() - now;
      if (delay <= 0) {
        this.enqueueAlert(entry.id);
        continue;
      }

      const timerId = window.setTimeout(() => {
        this.triggerAlert(entry.id);
      }, delay);

      this.alertTimers.set(entry.id, timerId);
    }

    this.flushAlertQueue();
  }

  private triggerAlert(entryId: string, invokedFromQueue = false): void {
    const entry = this.entries.find((item) => item.id === entryId);
    if (!entry) {
      return;
    }

    if (entry.alertTriggered && entry.triggeredAt && this.isEntryLocked(entry)) {
      return;
    }

    this.alertTimers.delete(entryId);
    this.removeFromQueue(entryId);

    if (!this.shouldAlertFor(entry)) {
      return;
    }

    if (this.activeAlert()) {
      if (!invokedFromQueue) {
        this.enqueueAlert(entryId);
      }
      return;
    }

    this.activeAlert.set(entry);
    this.countdownSeconds.set(60);
    this.startCountdown(60);
    const triggerTime = new Date();
    entry.alertTriggered = true;
    entry.triggeredAt = triggerTime;
    this.playAlarmFor(entry);
    this.recordHistory(entry, triggerTime);
  this.sortEntries();
    this.refreshBossesSignal();
    this.scheduleRemoval(entry.id);
  }

  protected stopAlert(): void {
    this.clearCountdown();
    this.stopAlarmOutputs();
    this.activeAlert.set(null);
    this.flushAlertQueue();
  }

  private enqueueAlert(entryId: string): void {
    if (this.pendingAlertIds.includes(entryId)) {
      return;
    }
    this.pendingAlertIds.push(entryId);
  }

  private flushAlertQueue(): void {
    if (this.activeAlert()) {
      return;
    }

    while (this.pendingAlertIds.length > 0) {
      const nextId = this.pendingAlertIds.shift();
      if (!nextId) {
        return;
      }
      const entry = this.entries.find((item) => item.id === nextId);
      if (!entry || entry.alertTriggered || !this.shouldAlertFor(entry) || this.isEntryLocked(entry)) {
        continue;
      }
      this.triggerAlert(nextId, true);
      break;
    }
  }

  private startCountdown(durationSeconds: number): void {
    if (typeof window === 'undefined') {
      return;
    }

    this.clearCountdown();
    this.countdownSeconds.set(durationSeconds);

    this.countdownIntervalId = window.setInterval(() => {
      const current = this.countdownSeconds();
      if (current <= 1) {
        this.countdownSeconds.set(0);
        this.stopAlert();
        return;
      }
      this.countdownSeconds.set(current - 1);
    }, 1000);

    this.autoStopTimeoutId = window.setTimeout(() => {
      this.stopAlert();
    }, durationSeconds * 1000);
  }

  private clearCountdown(): void {
    if (typeof window === 'undefined') {
      return;
    }

    if (this.countdownIntervalId !== null) {
      window.clearInterval(this.countdownIntervalId);
      this.countdownIntervalId = null;
    }

    if (this.autoStopTimeoutId !== null) {
      window.clearTimeout(this.autoStopTimeoutId);
      this.autoStopTimeoutId = null;
    }

    this.countdownSeconds.set(0);
  }

  private playAlarmFor(entry: BossEntry): void {
    this.stopPreviewOutputs();
    const selectedOption = this.ensureSelectedAlertSound();

    if (selectedOption?.type === 'audio') {
      if (this.startCustomSound(entry, selectedOption)) {
        return;
      }
    } else if (selectedOption?.type === 'tts') {
      if (this.trySpeakAlert(entry)) {
        return;
      }
    }

    if (selectedOption?.type !== 'tts' && this.trySpeakAlert(entry)) {
      return;
    }

    this.startTone(entry.serverType);
  }

  private trySpeakAlert(entry: BossEntry): boolean {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      return false;
    }

    this.stopActiveAudio(true);
    this.stopTone(true);

    const message = this.buildSpeechText(entry);
    if (!message.trim()) {
      return false;
    }

    return this.startSpeechLoop(entry, message);
  }

  private buildSpeechText(entry: BossEntry): string {
    const serverText = entry.serverType === 'cross' ? 'ข้ามเซิฟเวอร์' : 'เซิฟเวอร์ตัวเอง';
    const spokenName = this.extractSpokenName(entry.name);
    return `บอส ${spokenName} ${serverText} กำลังจะเกิด`;
  }

  private extractSpokenName(name: string): string {
    if (!name.trim()) {
      return name;
    }

    const normalized = name.replace(/[–—]/g, '-');
    const segments = normalized
      .split('-')
      .map((segment) => segment.trim())
      .filter(Boolean);

    const thaiRegex = /[\u0E00-\u0E7F]/;
    const candidate = segments.find((segment) => thaiRegex.test(segment)) ?? segments[0] ?? normalized;

    const cleaned = candidate
      .replace(/\((?:\s*)\)/g, ' ')
      .replace(/[A-Za-z]/g, ' ')
      .replace(/["'`’]/g, ' ')
      .replace(/[()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (cleaned) {
      return cleaned;
    }

    const fallback = normalized
      .replace(/[A-Za-z]/g, ' ')
      .replace(/["'`’]/g, ' ')
      .replace(/[()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return fallback || name;
  }

  private startSpeechLoop(entry: BossEntry, message: string): boolean {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      return false;
    }

    const synth = window.speechSynthesis;

    const speakOnce = (): void => {
      if (!this.shouldContinueSpeech(entry)) {
        if (this.activeSpeechEntryId === entry.id) {
          this.activeSpeechEntryId = null;
        }
        return;
      }

      const utterance = new SpeechSynthesisUtterance(message);
      utterance.lang = this.speechVoice?.lang ?? 'th-TH';
      if (this.speechVoice) {
        utterance.voice = this.speechVoice;
      }
      utterance.volume = Math.max(0, Math.min(1, this.volumePercent() / 100));
      utterance.rate = 1;
      utterance.pitch = 1;

      utterance.onend = () => {
        if (this.activeUtterance === utterance) {
          this.activeUtterance = null;
        }

        if (!this.shouldContinueSpeech(entry)) {
          if (this.activeSpeechEntryId === entry.id) {
            this.activeSpeechEntryId = null;
          }
          return;
        }

        if (typeof window !== 'undefined') {
          window.setTimeout(() => speakOnce(), 150);
        } else {
          speakOnce();
        }
      };

      utterance.onerror = () => {
        if (this.activeUtterance === utterance) {
          this.activeUtterance = null;
        }

        const shouldFallback = this.shouldContinueSpeech(entry);
        if (this.activeSpeechEntryId === entry.id) {
          this.activeSpeechEntryId = null;
        }

        if (shouldFallback) {
          this.startTone(entry.serverType);
        }
      };

      try {
        this.activeUtterance = utterance;
        synth.speak(utterance);
      } catch {
        this.activeUtterance = null;
        throw new Error('speech failed');
      }
    };

    try {
      synth.cancel();
    } catch {
      // ignore inability to cancel
    }

    this.activeSpeechEntryId = entry.id;

    try {
      speakOnce();
      return true;
    } catch {
      this.activeSpeechEntryId = null;
      return false;
    }
  }

  private shouldContinueSpeech(entry: BossEntry): boolean {
    const current = this.activeAlert();
    return !!current && current.id === entry.id && this.countdownSeconds() > 0;
  }

  private startTone(serverType: ServerType): void {
    const ctx = this.ensureAudioContext();
    if (!ctx) {
      return;
    }

    this.stopTone(true);
    this.activeSpeechEntryId = null;

    const gain = ctx.createGain();
    const oscillator = ctx.createOscillator();

    oscillator.type = serverType === 'cross' ? 'sawtooth' : 'sine';
    oscillator.frequency.value = serverType === 'cross' ? 880 : 660;

    const startTime = ctx.currentTime;
    const targetGain = this.volumeToGain(this.volumePercent());
    const rampTarget = targetGain === 0 ? 0.0001 : targetGain;

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(rampTarget, startTime + 0.1);
    if (targetGain === 0) {
      gain.gain.setValueAtTime(0, startTime + 0.12);
    }

    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start();

    this.audioGain = gain;
    this.activeOscillator = oscillator;
  }

  private stopTone(immediate = false): void {
    if (!this.audioContext) {
      return;
    }

    const ctx = this.audioContext;

    if (this.audioGain) {
      const targetTime = immediate ? ctx.currentTime : ctx.currentTime + 0.05;
      this.audioGain.gain.cancelScheduledValues(ctx.currentTime);
      this.audioGain.gain.setTargetAtTime(0.0001, targetTime, 0.05);
    }

    if (this.activeOscillator) {
      try {
        this.activeOscillator.stop(ctx.currentTime + (immediate ? 0 : 0.1));
      } catch {
        // oscillator might already be stopped
      }
      this.activeOscillator.disconnect();
    }

    this.audioGain = null;
    this.activeOscillator = null;
  }

  private cancelSpeech(): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }
    window.speechSynthesis.cancel();
    this.activeUtterance = null;
    this.activeSpeechEntryId = null;
  }

  private stopAlarmOutputs(immediate = false): void {
    this.cancelSpeech();
    this.stopActiveAudio(immediate);
    this.stopTone(immediate);
  }

  private ensureAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') {
      return null;
    }

    if (!this.audioContext) {
      const globalWindow = window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      };
      const AudioContextCtor = globalWindow.AudioContext ?? globalWindow.webkitAudioContext;
      if (!AudioContextCtor) {
        return null;
      }
      this.audioContext = new AudioContextCtor();
    }

    if (this.audioContext.state === 'suspended') {
      void this.audioContext.resume();
    }

    return this.audioContext;
  }

  private clearAlertTimers(): void {
    if (typeof window === 'undefined') {
      return;
    }

    this.alertTimers.forEach((timerId) => window.clearTimeout(timerId));
    this.alertTimers.clear();
  }

  private clearTimerFor(entryId: string): void {
    if (typeof window === 'undefined') {
      return;
    }

    const timerId = this.alertTimers.get(entryId);
    if (timerId !== undefined) {
      window.clearTimeout(timerId);
      this.alertTimers.delete(entryId);
    }
  }

  private removeFromQueue(entryId: string): void {
    const index = this.pendingAlertIds.indexOf(entryId);
    if (index !== -1) {
      this.pendingAlertIds.splice(index, 1);
    }
  }

  private scheduleRemoval(entryId: string): void {
    if (typeof window === 'undefined') {
      return;
    }

    this.clearRemovalTimer(entryId);

    const timerId = window.setTimeout(() => {
      this.finalizeRemoval(entryId);
    }, 120 * 1000);

    this.removalTimers.set(entryId, timerId);
  }

  private finalizeRemoval(entryId: string): void {
    if (typeof window === 'undefined') {
      return;
    }

    this.clearRemovalTimer(entryId);

    const index = this.entries.findIndex((item) => item.id === entryId);
    if (index === -1) {
      return;
    }

    this.entries.splice(index, 1);
    this.recalculateAlertTimes();
    this.refreshBossesSignal();
    this.scheduleAlerts();
  }

  private recordHistory(entry: BossEntry, triggeredAt: Date): void {
    if (entry.historyLoggedAt && Math.abs(entry.historyLoggedAt.getTime() - triggeredAt.getTime()) < 1000) {
      return;
    }

    const historyEntry: BossHistoryEntry = {
      id: entry.id,
      name: entry.name,
      map: entry.map,
      clan: entry.clan,
      serverType: entry.serverType,
      spawnTime: new Date(entry.spawnTime),
      spawnLabel: entry.spawnLabel,
      alertTime: new Date(entry.alertTime),
      alertLabel: entry.alertLabel,
      triggeredAt
    };

    this.historyLog.unshift(historyEntry);
    this.history.set([...this.historyLog]);
    this.ensureValidClanFilter();
    entry.historyLoggedAt = triggeredAt;
  }

  private ensureValidClanFilter(): void {
    const current = this.clanFilter();
    if (current === 'all') {
      return;
    }
    const options = this.clanOptions();
    if (!options.includes(current)) {
      this.clanFilter.set('all');
    }
  }

  private startNowTicker(): void {
    if (typeof window === 'undefined') {
      return;
    }

    this.now.set(new Date());
    this.nowTickerId = window.setInterval(() => {
      this.now.set(new Date());
    }, 1000);
  }

  private normalizeTime(value: string): string {
    const [hourPart, minutePart] = value.split(':');
    const hour = Number(hourPart);
    const minute = Number(minutePart);
    const safeHour = Number.isFinite(hour) ? hour : 0;
    const safeMinute = Number.isFinite(minute) ? minute : 0;
    return `${safeHour.toString().padStart(2, '0')}:${safeMinute.toString().padStart(2, '0')}`;
  }

  private computeNextOccurrence(label: string): Date {
    const [hour, minute] = label.split(':').map((value) => Number(value));
    const now = new Date();
    const result = new Date(now);
    result.setSeconds(0, 0);
    result.setHours(hour, minute, 0, 0);

    if (result.getTime() <= now.getTime()) {
      result.setDate(result.getDate() + 1);
    }

    return result;
  }

  protected displayTime(date: Date): string {
    return DISPLAY_FORMAT.format(date);
  }

  protected timeUntilAlert(entry: BossEntry): string {
    if (entry.alertTriggered) {
      return 'แจ้งเตือนแล้ว';
    }
    const diffMs = entry.alertTime.getTime() - this.now().getTime();
    if (diffMs <= 0) {
      return 'ถึงเวลาแล้ว';
    }

    const totalSeconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (minutes > 0) {
      return `${minutes} นาที ${seconds.toString().padStart(2, '0')} วิ`;
    }

    return `${seconds} วิ`;
  }

  private updateVolumePercent(value: number): void {
    const clamped = Math.max(0, Math.min(100, Math.round(value)));
    this.volumePercent.set(clamped);
    this.applyVolumeToActiveAlarm();
  }

  private applyVolumeToActiveAlarm(): void {
    if (this.activeUtterance) {
      this.activeUtterance.volume = Math.max(0, Math.min(1, this.volumePercent() / 100));
    }

    if (this.activeAudioElement) {
      this.activeAudioElement.volume = Math.max(0, Math.min(1, this.volumePercent() / 100));
    }

    if (!this.audioContext || !this.audioGain) {
      return;
    }

    const ctx = this.audioContext;
    const targetGain = this.volumeToGain(this.volumePercent());
    const safeTarget = targetGain === 0 ? 0.0001 : targetGain;

    this.audioGain.gain.cancelScheduledValues(ctx.currentTime);
    this.audioGain.gain.setTargetAtTime(safeTarget, ctx.currentTime, 0.05);
    if (targetGain === 0) {
      this.audioGain.gain.setValueAtTime(0, ctx.currentTime + 0.1);
    }
  }

  private ensureSelectedAlertSound(): AlertSoundOption | null {
    const options = this.alertSoundOptions();
    if (!options.length) {
      return null;
    }

    const selectedId = this.selectedAlertSoundId();
    let selected = options.find((option) => option.id === selectedId && !option.disabled) ?? null;

    if (!selected) {
      selected = options.find((option) => !option.disabled) ?? options[0] ?? null;
      if (selected) {
        this.selectedAlertSoundId.set(selected.id);
      }
    }

    return selected;
  }

  private startCustomSound(entry: BossEntry, option: AlertSoundOption): boolean {
    if (!option.source) {
      return false;
    }

    this.cancelSpeech();
    this.stopTone(true);
    this.stopActiveAudio(true);

    const audio = new Audio(option.source);
    audio.loop = true;
    audio.volume = Math.max(0, Math.min(1, this.volumePercent() / 100));

    audio.onerror = () => {
      if (this.activeAudioElement === audio) {
        this.stopActiveAudio(true);
        if (this.activeAlert()?.id === entry.id) {
          this.startTone(entry.serverType);
        }
      }
    };

  this.activeAudioElement = audio;

    void audio.play().catch(() => {
      if (this.activeAudioElement === audio) {
        this.stopActiveAudio(true);
        if (this.activeAlert()?.id === entry.id) {
          this.startTone(entry.serverType);
        }
      }
    });

    return true;
  }

  private startPreviewAudio(source: string): void {
    if (typeof Audio === 'undefined') {
      this.soundTestMessage.set('อุปกรณ์นี้ไม่รองรับการเล่นไฟล์เสียง');
      return;
    }

    this.isTestingAlertSound.set(true);

    const audio = new Audio(source);
    audio.loop = false;
    audio.volume = Math.max(0, Math.min(1, this.volumePercent() / 100));

    audio.onended = () => {
      if (this.previewAudioElement === audio) {
        this.previewAudioElement = null;
      }
      this.stopPreviewOutputs();
    };

    audio.onerror = () => {
      if (this.previewAudioElement === audio) {
        this.previewAudioElement = null;
      }
      this.stopPreviewOutputs();
      this.soundTestMessage.set('เล่นไฟล์เสียงไม่ได้');
    };

    this.previewAudioElement = audio;

    if (typeof window !== 'undefined') {
      this.clearPreviewTimeout();
      this.previewTimeoutId = window.setTimeout(() => this.stopPreviewOutputs(), 5000);
    }

    void audio.play().catch(() => {
      if (this.previewAudioElement === audio) {
        this.previewAudioElement = null;
      }
      this.stopPreviewOutputs();
      this.soundTestMessage.set('เล่นไฟล์เสียงไม่ได้');
    });
  }

  private startPreviewSpeech(): boolean {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      return false;
    }

    const utterance = new SpeechSynthesisUtterance('นี่คือเสียงทดสอบแจ้งเตือนบอส');
    utterance.lang = this.speechVoice?.lang ?? 'th-TH';
    if (this.speechVoice) {
      utterance.voice = this.speechVoice;
    }
    utterance.volume = Math.max(0, Math.min(1, this.volumePercent() / 100));
    utterance.rate = 1;
    utterance.pitch = 1;

    utterance.onend = () => {
      if (this.previewUtterance === utterance) {
        this.previewUtterance = null;
      }
      this.stopPreviewOutputs();
    };

    utterance.onerror = () => {
      if (this.previewUtterance === utterance) {
        this.previewUtterance = null;
      }
      this.stopPreviewOutputs();
      this.soundTestMessage.set('ไม่สามารถทดสอบเสียงพูดได้');
    };

    try {
      this.isTestingAlertSound.set(true);
      this.previewUtterance = utterance;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
      return true;
    } catch {
      this.previewUtterance = null;
      this.stopPreviewOutputs();
      return false;
    }
  }

  private stopPreviewOutputs(): void {
    if (this.previewAudioElement) {
      this.previewAudioElement.pause();
      this.previewAudioElement.currentTime = 0;
      this.previewAudioElement = null;
    }

    if (typeof window !== 'undefined' && this.previewUtterance) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore inability to cancel preview speech
      }
    }
    this.previewUtterance = null;

    this.clearPreviewTimeout();
    this.isTestingAlertSound.set(false);
  }

  private clearPreviewTimeout(): void {
    if (typeof window !== 'undefined' && this.previewTimeoutId !== null) {
      window.clearTimeout(this.previewTimeoutId);
    }
    this.previewTimeoutId = null;
  }

  private stopActiveAudio(immediate = false): void {
    if (!this.activeAudioElement) {
      return;
    }

    const audio = this.activeAudioElement;
    this.activeAudioElement = null;

    audio.pause();
    if (immediate) {
      audio.currentTime = 0;
    }
  }

  private isMp3File(file: File): boolean {
    const name = (file.name ?? '').toLowerCase();
    const extensionOk = name.endsWith('.mp3');
    if (!extensionOk) {
      return false;
    }
    const type = (file.type ?? '').toLowerCase();
    return !type || type === 'audio/mpeg' || type === 'audio/mp3';
  }

  private revokeUploadedSoundUrl(id: string): void {
    const url = this.uploadedSoundUrls.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      this.uploadedSoundUrls.delete(id);
    }
  }

  private revokeAllUploadedSoundUrls(): void {
    for (const url of this.uploadedSoundUrls.values()) {
      URL.revokeObjectURL(url);
    }
    this.uploadedSoundUrls.clear();
  }

  private volumeToGain(percent: number): number {
    const normalized = Math.max(0, Math.min(100, percent)) / 100;
    return normalized * 0.4;
  }

  private generateId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
    return `boss-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}
