# Plan: Multi-Account & Mention Support für OpenWebUI Plugin

## Context
Das OpenWebUI Plugin unterstützt aktuell nur einen einzigen Account (`listAccountIds: () => ["default"]`). Ziel:
1. Pro OpenClaw-Agent einen eigenen OpenWebUI-User → Multi-Account
2. Gruppen-Channels, in denen mehrere Bots per @mention angesprochen werden

Alle Änderungen betreffen **nur das Plugin** (`src/`). OpenClaw Core unterstützt beides bereits nativ.

---

## Schritt 1: Config-Struktur auf Multi-Account umstellen

**Datei:** `src/channel.ts`

Ziel-Config:
```yaml
channels:
  open-webui:
    # Base (shared) config
    baseUrl: "http://open-webui:8080"
    requireMention: true

    accounts:
      butler:
        email: "butler@local"
        password: "..."
        channelIds: ["uuid-1", "uuid-2"]
        name: "Butler"
      researcher:
        email: "researcher@local"
        password: "..."
        channelIds: ["uuid-2"]
        name: "Research Specialist"
```

Rückwärtskompatibel: Flat config (email/password auf Top-Level) → wird als `accounts.default` behandelt.

### Änderungen:
- `OpenWebUIAccountConfig` Interface für per-Account Settings
- `resolveOpenWebUIAccount()`: Liest `channels.open-webui.accounts.<id>`, merged mit Base-Config
- `listAccountIds`: Liest Keys aus `accounts` Object, Fallback `["default"]`
- `defaultAccountId`: Erster konfigurierter Account oder `"default"`

---

## Schritt 2: Gateway Multi-Account Startup

**Datei:** `src/channel.ts`

Core ruft `startAccount(ctx)` automatisch pro Account-ID auf. Funktioniert bereits, weil:
- `ctx.accountId` und `ctx.account` werden vom Core gesetzt
- `monitorOpenWebUIProvider()` bekommt den resolved Account
- `socket.ts` Connection Pool keyed auf `baseUrl:email` → separate Connections pro Account
- `accountBotUserId` Map: Per accountId gekeyed
- `channelNameCache`: Per `accountId:channelId` gekeyed

---

## Schritt 3: Inbound Routing mit Account-ID

Funktioniert bereits:
- `ctxPayload.AccountId`: Bereits `account.accountId`
- `resolveAgentRoute()`: Bereits mit `accountId: account.accountId`

---

## Schritt 4: Mention-Gating für Gruppen

### Änderungen:
- `mentions.stripPatterns` Adapter: Strip `<@U:USER_ID|Name>` und `<@U:USER_ID>` Syntax
- Implicit Mention: Reply auf Bot-Nachricht → auch als Mention werten (fetcht replied-to message, prüft user_id)
- Plugin-seitiges `requireMention` Filtering bleibt (greift VOR dispatch)

---

## Schritt 5: Account Management

### Änderungen:
- `setAccountEnabled`: Per-Account enabled/disabled setzen (Multi-Account) oder Flat-Config Fallback
- `deleteAccount`: Per-Account löschen, wenn letzter Account → ganzes Plugin-Config entfernen

---

## Schritt 6: Outbound Delivery

Funktioniert bereits — `sendText`/`sendMedia` bekommen `accountId` als Parameter und nutzen `resolveOpenWebUIAccount(cfg, accountId)`.

---

## Implementiert in

| Datei | Änderung | Status |
|-------|----------|--------|
| `src/channel.ts` | `OpenWebUIAccountConfig` Interface | ✅ |
| `src/channel.ts` | `resolveOpenWebUIAccount()` → Multi-Account Config | ✅ |
| `src/channel.ts` | `listOpenWebUIAccountIds()` + `defaultOpenWebUIAccountId()` | ✅ |
| `src/channel.ts` | `mentions.stripPatterns` Adapter | ✅ |
| `src/channel.ts` | Implicit Mention (Reply auf Bot) Detection | ✅ |
| `src/channel.ts` | `setAccountEnabled` / `deleteAccount` per Account | ✅ |
| `src/channel.ts` | `requireMention` per Account überschreibbar | ✅ |

Keine neuen Dateien. Keine Änderungen an `socket.ts`, `api.ts`, `runtime.ts`.

---

## Verifikation

1. **Config Test:** Flat config (rückwärtskompatibel) → Plugin startet mit `default` Account
2. **Multi-Account Test:** Zwei Accounts konfigurieren → zwei Socket-Connections, zwei Bot-User-IDs im Log
3. **Mention Test:** Nachricht ohne @mention in Gruppen-Channel → wird ignoriert. Mit @mention → wird verarbeitet
4. **Implicit Mention:** Reply auf Bot-Nachricht → wird verarbeitet (auch ohne @mention)
5. **Cross-Account:** Nachricht in Channel wo beide Bots sind, nur einen @mentionen → nur dieser reagiert
6. **Outbound:** Sub-Agent Delivery mit korrektem `accountId` → richtiger Bot postet

---

## Offen / Future

### "Observe all, respond on mention" Modus
**Problem:** Aktuell filtert `requireMention` Nachrichten komplett weg — der Agent sieht sie nie. Gewünscht: Agent liest im Channel mit (alle Nachrichten fließen in Session-Context), antwortet aber nur bei @mention.

**Benötigt:** Core-Support für ein `observeOnly`/`appendToSession` Flag im Context-Payload, das die Nachricht in die Session-History schreibt ohne einen Agent-Turn zu triggern. Ohne Core-Änderung im Plugin allein nicht umsetzbar.

### Code-Fix: `defaultAccountId` ohne hartkodierten "default"
Der Core scheint intern `"default"` als Account-ID zu erwarten. `defaultOpenWebUIAccountId()` gibt zwar den ersten Account zurück, aber der Core fragt ggf. trotzdem `"default"` hart ab. Untersuchen ob das ein Core-Issue ist oder ob das Plugin es abfangen kann.
