// Мінімальний зріз AirConsole SDK 1.8 (підключається <script>-тегом),
// спільний для екрана і контролера.
declare class AirConsole {
  static readonly SCREEN: number;
  static readonly ORIENTATION_PORTRAIT: string;
  static readonly ORIENTATION_LANDSCAPE: string;

  constructor(opts?: { orientation?: string });

  message(to: number, data: unknown): void;
  broadcast(data: unknown): void;
  getNickname(deviceId: number): string;

  onConnect: (deviceId: number) => void;
  onDisconnect: (deviceId: number) => void;
  onMessage: (from: number, data: unknown) => void;
}
