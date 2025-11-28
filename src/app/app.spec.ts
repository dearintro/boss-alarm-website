import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render hero header and empty state', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.hero h1')?.textContent).toContain('เว็บกรอกเวลาแจ้งเตือนบอส');
    expect(compiled.querySelector('.empty-state')?.textContent).toContain('ยังไม่มีข้อมูลบอส');
  });

  it('should remove English portion from speech text', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;

    const speech = app.buildSpeechText({
      id: 'test-1',
      name: 'โครูน - Korun',
      map: 'ทุ่งโครูน',
      clan: 'TestClan',
      serverType: 'own',
      spawnTime: new Date(),
      spawnLabel: '21:30',
      alertTime: new Date(),
      alertLabel: '21:27',
      createdOrder: 1,
      alertTriggered: false,
      triggeredAt: null,
      leadMinutes: 3,
    });

    expect(speech).toBe('บอส โครูน เซิฟเวอร์ตัวเอง กำลังจะเกิด');
  });

  it('should fall back to original name when no Thai characters are present', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;

    const speech = app.buildSpeechText({
      id: 'test-2',
      name: 'Korun',
      map: 'ทุ่งโครูน',
      clan: 'TestClan',
      serverType: 'cross',
      spawnTime: new Date(),
      spawnLabel: '21:30',
      alertTime: new Date(),
      alertLabel: '21:27',
      createdOrder: 2,
      alertTriggered: false,
      triggeredAt: null,
      leadMinutes: 3,
    });

    expect(speech).toBe('บอส Korun ข้ามเซิฟเวอร์ กำลังจะเกิด');
  });

  it('should trigger alert immediately when reducing lead with less than a minute remaining', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;

    spyOn<any>(app, 'startCountdown').and.stub();
    spyOn<any>(app, 'playAlarmFor').and.stub();

    const baseNow = new Date('2025-01-01T12:00:00Z').getTime();
    const nowSpy = spyOn(Date, 'now').and.returnValue(baseNow);

    const entry = {
      id: 'entry-test',
      name: 'โครูน',
      map: 'Test Map',
      clan: 'TestClan',
      serverType: 'own',
      spawnTime: new Date(baseNow + 4 * 60_000),
      spawnLabel: '12:04',
      alertTime: new Date(baseNow + 30_000),
      alertLabel: '12:00',
      createdOrder: 1,
      alertTriggered: false,
      triggeredAt: null,
      leadMinutes: 3
    };

    app['entries'].push(entry);

    app.adjustAlertLead(entry, 0);

    expect(entry.leadMinutes).toBe(0);
    expect(entry.alertTime.getTime()).toBe(baseNow);
    expect(entry.alertTriggered).toBeTrue();

    nowSpy.and.callThrough();
  });

  it('should expose default TTS option alongside built-in sounds', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;

    const options = app.alertSoundOptions();
    const ids = options.map((option: any) => option.id);

    expect(ids).toContain('tts-default');
    expect(options.filter((option: any) => option.id.startsWith('builtin-')).length).toBeGreaterThan(0);
  });

  it('should reject non-mp3 files during upload', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;

    const badFile = new File(['test'], 'sound.wav', { type: 'audio/wav' });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', {
      value: [badFile],
      writable: false,
    });

  app.onAlertSoundUpload({ target: input } as unknown as Event);

    expect(app.uploadError()).toContain('.mp3');
    expect(app.uploadedSounds().length).toBe(0);
  });

  it('should add uploaded mp3 sound and select it', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;

    const goodFile = new File(['test'], 'custom.mp3', { type: 'audio/mpeg' });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', {
      value: [goodFile],
      writable: false,
    });

    const createObjectURLSpy = spyOn(URL, 'createObjectURL').and.returnValue('blob:custom-sound');

  app.onAlertSoundUpload({ target: input } as unknown as Event);

    const uploaded = app.uploadedSounds();
    expect(app.uploadError()).toBeNull();
    expect(uploaded.length).toBe(1);
    expect(uploaded[0].label).toContain('อัปโหลด');
    expect(app.selectedAlertSoundId()).toBe(uploaded[0].id);
    expect(app.alertSoundOptions().some((option: any) => option.id === uploaded[0].id)).toBeTrue();

    createObjectURLSpy.and.callThrough();
  });

  it('should open confirmation modal with boss info when requesting removal', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;

    const entry = {
      id: 'remove-1',
      name: 'เจ้าป่า',
      map: 'โฟเรส',
      clan: 'TestClan',
      serverType: 'own',
      spawnTime: new Date(),
      spawnLabel: '10:00',
      alertTime: new Date(),
      alertLabel: '09:57',
      createdOrder: 1,
      alertTriggered: false,
      triggeredAt: null,
      leadMinutes: 3
    };

    app['entries'].push(entry);

    app.requestBossRemoval(entry.id);

    expect(app.deleteConfirmation()).toEqual({ id: entry.id, name: entry.name });
  });

  it('should reset confirmation state when cancelling removal', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;

    app['deleteConfirmationState'].set({ id: 'temp', name: 'ชั่วคราว' });

    app.cancelBossRemoval();

    expect(app.deleteConfirmation()).toBeNull();
  });

  it('should remove boss and clear timers on confirm', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;

    const entry = {
      id: 'remove-2',
      name: 'จ้าวสมุทร',
      map: 'Ocean',
      clan: 'Guild',
      serverType: 'cross',
      spawnTime: new Date(),
      spawnLabel: '12:00',
      alertTime: new Date(),
      alertLabel: '11:57',
      createdOrder: 2,
      alertTriggered: false,
      triggeredAt: null,
      leadMinutes: 3
    };

    app['entries'].push(entry);
    app['pendingAlertIds'].push(entry.id);
    app['alertTimers'].set(entry.id, 123 as unknown as number);
    app['removalTimers'].set(entry.id, 456 as unknown as number);

    spyOn(window, 'clearTimeout').and.callThrough();
    spyOn<any>(app, 'recalculateAlertTimes').and.stub();
    spyOn<any>(app, 'refreshBossesSignal').and.stub();
    spyOn<any>(app, 'scheduleAlerts').and.stub();

    app.requestBossRemoval(entry.id);
    app.confirmBossRemoval();

    expect(app.deleteConfirmation()).toBeNull();
    expect(app['entries'].length).toBe(0);
    expect(app['pendingAlertIds']).not.toContain(entry.id);
    expect(app['alertTimers'].size).toBe(0);
    expect(app['removalTimers'].size).toBe(0);
  });
});
