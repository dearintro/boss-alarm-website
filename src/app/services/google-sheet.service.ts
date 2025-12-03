import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

interface GoogleSheetResponse<T> {
  success?: boolean;
  message?: string;
  data?: T;
  bossNames?: string[];
}

export interface SheetBossListItem {
  bossName: string;
  owner: string;
  formattedTime: string;
}

export interface SheetBossEntry {
  id: number;
  bossName: string;
  hours: number | string | null;
  spawnTime: string;
  owner?: string;
  status?: string;
  notified: boolean;
}

export interface UpdateBossTimePayload {
  name: string;
  time: string;
  owner?: string;
}

export interface AddBossPayload {
  name: string;
  hours: number;
}

@Injectable({ providedIn: 'root' })
export class GoogleSheetService {
  private readonly http = inject(HttpClient);
  private readonly scriptUrl = 'https://script.google.com/macros/s/AKfycbxRfVQlKZR9fqrADB8JizcK9t-u5P1Lym8zk009WlyEeIB5CchuvN1H0T78bx4WGs71/exec'
  // private readonly scriptUrl = 'https://script.google.com/macros/d/AKfycbxRfVQlKZR9fqrADB8JizcK9t-u5P1Lym8zk009WlyEeIB5CchuvN1H0T78bx4WGs71/usercallback';
// https://script.google.com/macros/s/AKfycbxRfVQlKZR9fqrADB8JizcK9t-u5P1Lym8zk009WlyEeIB5CchuvN1H0T78bx4WGs71/exec
  fetchBossList(): Observable<SheetBossListItem[]> {
    const params = this.buildParams('list');
    return this.http
      .get<GoogleSheetResponse<SheetBossListItem[]>>(this.scriptUrl, { params })
      .pipe(
        map((response) => {
          if (Array.isArray(response?.data)) {
            return response.data;
          }
          if (response?.message) {
            return this.parseSheetMessage(response.message);
          }
          if (response && response.success === false) {
            throw new Error(response.message ?? 'ไม่สามารถดึงรายชื่อบอสได้');
          }
          return [];
        })
      );
  }

  fetchBossNames(): Observable<string[]> {
    const params = this.buildParams('get_boss_names');
    return this.http
      .get<GoogleSheetResponse<never>>(this.scriptUrl, { params })
      .pipe(
        map((response) => {
          const safe = this.ensureSuccess(response, 'ไม่สามารถดึงรายชื่อบอสทั้งหมดได้');
          if (Array.isArray(safe.bossNames)) {
            return safe.bossNames;
          }
          if (Array.isArray(safe.data)) {
            return safe.data as string[];
          }
          return [];
        })
      );
  }

  fetchAllBosses(): Observable<SheetBossEntry[]> {
    const params = this.buildParams('get_all_bosses');
    return this.http
      .get<GoogleSheetResponse<SheetBossEntry[]>>(this.scriptUrl, { params })
      .pipe(map((response) => this.ensureSuccess(response, 'ไม่สามารถดึงข้อมูลบอสทั้งหมดได้').data ?? []));
  }

  updateBossTime(payload: UpdateBossTimePayload): Observable<string> {
    return this.http
      .post<GoogleSheetResponse<never>>(this.scriptUrl, {
        action: 'update_boss_time',
        name: payload.name,
        time: payload.time,
        owner: payload.owner ?? ''
      })
      .pipe(map((response) => this.extractMessage(response, 'อัปเดตเวลาบอสไม่สำเร็จ')));
  }

  addBoss(payload: AddBossPayload): Observable<string> {
    return this.http
      .post<GoogleSheetResponse<never>>(this.scriptUrl, {
        action: 'add_boss',
        name: payload.name,
        hours: payload.hours
      })
      .pipe(map((response) => this.extractMessage(response, 'เพิ่มบอสใหม่ไม่สำเร็จ')));
  }

  resetNotification(rowIndex: number): Observable<string> {
    return this.http
      .post<GoogleSheetResponse<never>>(this.scriptUrl, {
        action: 'reset_notification',
        rowIndex
      })
      .pipe(map((response) => this.extractMessage(response, 'รีเซ็ตสถานะแจ้งเตือนไม่สำเร็จ')));
  }

  private buildParams(action: string): HttpParams {
    return new HttpParams().set('action', action);
  }

  private ensureSuccess<T>(response: GoogleSheetResponse<T>, fallbackMessage: string): GoogleSheetResponse<T> {
    if (!response.success) {
      throw new Error(response.message ?? fallbackMessage);
    }
    return response;
  }

  private extractMessage(response: GoogleSheetResponse<never>, fallbackMessage: string): string {
    this.ensureSuccess(response, fallbackMessage);
    return response.message ?? fallbackMessage;
  }

  private parseSheetMessage(raw: string): SheetBossListItem[] {
    const lines = (raw ?? '')
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);

    const pattern = /^🕐?\s*(?<time>\d{1,2}:\d{2})\s*-\s*\*\*(?<body>.+?)\*\*\s*\(ของ\s*(?<owner>[^)]+)\)\s*$/u;

    const items: SheetBossListItem[] = [];

    for (const line of lines) {
      const match = line.match(pattern);
      if (!match || !match.groups) {
        continue;
      }
      const formattedTime = match.groups['time']?.trim() ?? '';
      const bossName = match.groups['body']?.trim() ?? '';
      const owner = match.groups['owner']?.trim() ?? '';
      if (!formattedTime || !bossName) {
        continue;
      }
      items.push({ formattedTime, bossName, owner });
    }

    return items;
  }
}
