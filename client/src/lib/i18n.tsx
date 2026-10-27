import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Device } from '@localme/shared';

export type Lang = 'en' | 'ar';

const en = {
  tagline: 'Share files with devices on the same network. Nothing is uploaded to a server — files stay on your device.',
  roomNetwork: 'Your network',
  roomPrivate: 'Private room',
  devices: 'Devices',
  you: 'You',
  addFiles: 'Add files',
  addFolder: 'Add folder',
  addText: 'Add text',
  dropHere: 'Drop files or folders here',
  dropSub: 'or paste an image / file from the clipboard',
  empty: 'Nothing shared yet',
  emptySub: 'Add something from this device, or open LocalMe on another device on the same network.',
  downloadAll: 'Download all (.zip)',
  download: 'Download',
  preview: 'Preview',
  lock: 'Set password',
  unlock: 'Remove password',
  remove: 'Remove',
  copy: 'Copy',
  copied: 'Copied',
  protectedFile: 'Protected',
  password: 'Password',
  passwordNeeded: 'This file is protected. Enter the password to download it.',
  wrongPassword: 'Wrong password, try again.',
  setPasswordTitle: 'Protect this file',
  setPasswordHelp: 'Anyone downloading it will be asked for this password. Leave empty to remove protection.',
  cancel: 'Cancel',
  ok: 'OK',
  share: 'Share',
  textPlaceholder: 'Type or paste text to share…',
  keepOpen: 'Keep this tab open. Your files stay on this device and disappear for everyone when you leave.',
  connecting: 'Connecting…',
  offline: 'Disconnected. Reconnecting…',
  roomFull: 'This room is full.',
  createRoom: 'Private room',
  joinRoom: 'Join with code',
  roomCode: 'Room code',
  leaveRoom: 'Back to my network',
  copyLink: 'Copy link',
  copyCode: 'Copy code',
  passwordOptional: 'Password (optional)',
  shareHint: 'Leave empty to share without a password. Anyone downloading will need to enter it.',
  roomNetworkNote: 'Devices on the same Wi-Fi appear here automatically.',
  createRoomHint: 'Only people with the code or QR can join.',
  createRoomBtn: 'Create private room',
  deleteAll: 'Delete all',
  deleteAllConfirm: 'Stop sharing all {n} item(s) you added? Other devices can no longer download them.',
  skipLink: 'Skip to shared files',
  addTitle: 'Add to share',
  sharedHeading: 'Shared files',
  youAre: 'You are',
  nearby: '{n} other devices here',
  nearbyOne: '1 other device here',
  alone: 'No other devices yet. Open LocalMe on another device on this network.',
  scanQr: 'Scan to join from another device',
  join: 'Join',
  invalidCode: 'Code must be 6 characters.',
  lockedSkipped: '{n} protected file(s) were skipped — download them one by one.',
  tooBigPreview: 'Too large to preview (limit 25 MB).',
  failed: 'Failed',
  ownerGone: 'The owner is no longer available.',
  interrupted: 'Transfer interrupted.',
  transfers: 'Transfers',
  dismiss: 'Dismiss',
  stop: 'Stop',
  done: 'Done',
  from: 'from {name}',
  close: 'Close',
  theme: 'Toggle theme',
  language: 'العربية',
  items: '{n} items',
  itemOne: '1 item',
  switchConfirm: 'Switching rooms stops sharing what you added here. Continue?',
  sharedByMe: 'Shared by you',
  shareTitle: 'Share {n} item(s)?',
  shareAsk: 'Do you want to protect it with a password? Anyone downloading it will have to enter it.',
  shareNoPw: 'Share without password',
  shareWithPw: 'Share with password',
} as const;

const ar: Record<keyof typeof en, string> = {
  tagline: 'شارك الملفات مع الأجهزة المتصلة بنفس الشبكة. لا يتم رفع أي شيء إلى خادم — الملفات تبقى على جهازك.',
  roomNetwork: 'شبكتك',
  roomPrivate: 'غرفة خاصة',
  devices: 'الأجهزة',
  you: 'أنت',
  addFiles: 'إضافة ملفات',
  addFolder: 'إضافة مجلد',
  addText: 'إضافة نص',
  dropHere: 'أفلت الملفات أو المجلدات هنا',
  dropSub: 'أو الصق صورة / ملفًا من الحافظة',
  empty: 'لا يوجد شيء مشارك بعد',
  emptySub: 'أضف شيئًا من هذا الجهاز، أو افتح LocalMe على جهاز آخر في نفس الشبكة.',
  downloadAll: 'تحميل الكل (.zip)',
  download: 'تحميل',
  preview: 'معاينة',
  lock: 'تعيين كلمة مرور',
  unlock: 'إزالة كلمة المرور',
  remove: 'حذف',
  copy: 'نسخ',
  copied: 'تم النسخ',
  protectedFile: 'محمي',
  password: 'كلمة المرور',
  passwordNeeded: 'هذا الملف محمي. أدخل كلمة المرور لتحميله.',
  wrongPassword: 'كلمة المرور خاطئة، حاول مرة أخرى.',
  setPasswordTitle: 'حماية هذا الملف',
  setPasswordHelp: 'سيُطلب من أي شخص يحمّله إدخال كلمة المرور. اتركها فارغة لإزالة الحماية.',
  cancel: 'إلغاء',
  ok: 'حسنًا',
  share: 'مشاركة',
  textPlaceholder: 'اكتب أو الصق نصًا للمشاركة…',
  keepOpen: 'أبقِ هذه الصفحة مفتوحة. ملفاتك تبقى على هذا الجهاز وتختفي للجميع عند مغادرتك.',
  connecting: 'جارٍ الاتصال…',
  offline: 'انقطع الاتصال. جارٍ إعادة المحاولة…',
  roomFull: 'هذه الغرفة ممتلئة.',
  createRoom: 'غرفة خاصة',
  joinRoom: 'انضم برمز',
  roomCode: 'رمز الغرفة',
  leaveRoom: 'العودة إلى شبكتي',
  copyLink: 'نسخ الرابط',
  copyCode: 'نسخ الرمز',
  passwordOptional: 'كلمة المرور (اختياري)',
  shareHint: 'اتركها فارغة للمشاركة بدون كلمة مرور. سيُطلب من كل من يحمّل الملف إدخالها.',
  roomNetworkNote: 'تظهر هنا الأجهزة المتصلة بنفس شبكة الواي فاي تلقائيًا.',
  createRoomHint: 'يمكن فقط لمن لديه الرمز أو رمز QR الانضمام.',
  createRoomBtn: 'إنشاء غرفة خاصة',
  deleteAll: 'حذف الكل',
  deleteAllConfirm: 'إيقاف مشاركة جميع العناصر ({n}) التي أضفتها؟ لن تتمكن الأجهزة الأخرى من تحميلها.',
  skipLink: 'تخطي إلى الملفات المشتركة',
  addTitle: 'إضافة للمشاركة',
  sharedHeading: 'الملفات المشتركة',
  youAre: 'أنت',
  nearby: '{n} جهاز آخر هنا',
  nearbyOne: 'جهاز واحد آخر هنا',
  alone: 'لا توجد أجهزة أخرى بعد. افتح LocalMe على جهاز آخر في هذه الشبكة.',
  scanQr: 'امسح الرمز للانضمام من جهاز آخر',
  join: 'انضمام',
  invalidCode: 'يجب أن يتكون الرمز من 6 أحرف.',
  lockedSkipped: 'تم تخطي {n} ملف محمي — حمّلها واحدًا تلو الآخر.',
  tooBigPreview: 'الملف كبير جدًا للمعاينة (الحد 25 ميغابايت).',
  failed: 'فشل',
  ownerGone: 'صاحب الملف لم يعد متاحًا.',
  interrupted: 'انقطع النقل.',
  transfers: 'عمليات النقل',
  dismiss: 'إخفاء',
  stop: 'إيقاف',
  done: 'تم',
  from: 'من {name}',
  close: 'إغلاق',
  theme: 'تبديل المظهر',
  language: 'English',
  items: '{n} عنصر',
  itemOne: 'عنصر واحد',
  switchConfirm: 'تبديل الغرفة سيوقف مشاركة ما أضفته هنا. هل تريد المتابعة؟',
  sharedByMe: 'شاركتَه أنت',
  shareTitle: 'مشاركة {n} عنصر؟',
  shareAsk: 'هل تريد حمايته بكلمة مرور؟ سيُطلب من كل من يحمّله إدخالها.',
  shareNoPw: 'مشاركة بدون كلمة مرور',
  shareWithPw: 'مشاركة بكلمة مرور',
};

const dict = { en, ar };
export type Key = keyof typeof en;

const ANIMALS = {
  en: ['Fox', 'Wolf', 'Owl', 'Cat', 'Bear', 'Lion', 'Eagle', 'Dolphin', 'Panda', 'Tiger', 'Falcon', 'Camel'],
  ar: ['ثعلب', 'ذئب', 'بومة', 'قط', 'دب', 'أسد', 'نسر', 'دولفين', 'باندا', 'نمر', 'صقر', 'جمل'],
};

interface Ctx {
  lang: Lang;
  toggleLang(): void;
  t(key: Key, vars?: Record<string, string | number>): string;
  deviceName(d: Pick<Device, 'animal' | 'num'> | undefined): string;
}

const I18n = createContext<Ctx>(null as unknown as Ctx);
export const useI18n = () => useContext(I18n);

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem('lm-lang');
    if (saved === 'ar' || saved === 'en') return saved;
  } catch {
    /* ignore */
  }
  return (navigator.language || 'en').toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    try {
      localStorage.setItem('lm-lang', lang);
    } catch {
      /* ignore */
    }
  }, [lang]);

  const t = useCallback<Ctx['t']>(
    (key, vars) => {
      let s: string = dict[lang][key];
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
      return s;
    },
    [lang],
  );

  const value = useMemo<Ctx>(
    () => ({
      lang,
      toggleLang: () => setLang((l) => (l === 'en' ? 'ar' : 'en')),
      t,
      deviceName: (d) => (d ? `${ANIMALS[lang][d.animal] ?? ANIMALS[lang][0]} ${d.num}` : '…'),
    }),
    [lang, t],
  );

  return <I18n.Provider value={value}>{children}</I18n.Provider>;
}
