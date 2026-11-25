// HighScore home-screen widget: today's games, which friends have posted, and
// whether you have. Data path: the app writes a compact JSON snapshot into the
// App Group's UserDefaults (`widget.snapshot`, written by
// apps/highscore/src/lib/homeWidget.ts after every `GET /v1/games` and every
// post) and asks WidgetKit to reload. This extension never touches the
// network: it renders the last snapshot, rolls it over to an empty day at
// local midnight, and asks for a fresh timeline every 30 minutes so a
// snapshot written while no reload went through still shows up.
//
// What it never shows: a friend's name, picture or score. Friends' results
// stay inside the app (privacy page); the widget only counts them.

import SwiftUI
import WidgetKit

let appGroup = "group.live.highscore.app"
let snapshotKey = "widget.snapshot"
let timelineMarkerKey = "widget.timelineAt"
let familiesKey = "widget.families"
let widgetKind = "HighScoreWidget"

// MARK: - Snapshot (mirror of WidgetSnapshot in src/lib/widgetSnapshot.ts)

struct SnapshotGame: Codable, Hashable {
  let id: String
  let name: String
  /// The viewer posted today.
  let you: Bool
  /// Friends with a score today.
  let played: Int
  /// Friends who have the game (the "of 5").
  let friends: Int
}

struct Snapshot: Codable {
  let v: Int
  let signedIn: Bool
  /// The viewer's local day the counts are for (YYYY-MM-DD).
  let day: String
  let games: [SnapshotGame]
  /// Games beyond the ones listed.
  let more: Int?
}

let snapshotFile = "widget-snapshot.json"
let markerFile = "widget-marker.json"

func groupFileURL(_ name: String) -> URL? {
  FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
    .appendingPathComponent(name)
}

/// The app's last snapshot: `widget-snapshot.json` in the App Group container
/// (always current), else the UserDefaults copy. A file because the
/// widget's process was seen reading a stale UserDefaults value right after
/// the app's write + reload.
func loadSnapshot() -> Snapshot? {
  if let url = groupFileURL(snapshotFile), let data = try? Data(contentsOf: url),
    let s = try? JSONDecoder().decode(Snapshot.self, from: data)
  {
    return s
  }
  CFPreferencesAppSynchronize(appGroup as CFString)
  guard
    let raw = UserDefaults(suiteName: appGroup)?.string(forKey: snapshotKey),
    let data = raw.data(using: .utf8)
  else { return nil }
  return try? JSONDecoder().decode(Snapshot.self, from: data)
}

func dayKey(_ date: Date) -> String {
  let f = DateFormatter()
  f.calendar = Calendar(identifier: .gregorian)
  f.locale = Locale(identifier: "en_US_POSIX")
  f.timeZone = .current
  f.dateFormat = "yyyy-MM-dd"
  return f.string(from: date)
}

/// A new day: same games, nobody has played yet.
func rolledOver(_ s: Snapshot, to day: String) -> Snapshot {
  Snapshot(
    v: s.v, signedIn: s.signedIn, day: day,
    games: s.games.map {
      SnapshotGame(id: $0.id, name: $0.name, you: false, played: 0, friends: $0.friends)
    },
    more: s.more)
}

/// The snapshot as it should read on `date`: a snapshot from an earlier day
/// shows that day's games with every dot empty.
func snapshot(_ s: Snapshot?, on date: Date) -> Snapshot? {
  guard let s else { return nil }
  let today = dayKey(date)
  return s.day < today ? rolledOver(s, to: today) : s
}

// MARK: - Deep links

func familyParam(_ family: WidgetFamily) -> String {
  switch family {
  case .systemSmall: return "small"
  case .systemMedium: return "medium"
  default: return "other"
  }
}

/// `highscore:///games/<id>?src=widget&family=…` opens the game's board, whose
/// paste slot leads until you've posted. No game → Games home.
func link(_ gameId: String?, _ family: WidgetFamily) -> URL {
  let path = gameId.map { "games/\($0)" } ?? ""
  return URL(string: "highscore:///\(path)?src=widget&family=\(familyParam(family))")!
}

// MARK: - Timeline

struct Entry: TimelineEntry {
  let date: Date
  let snapshot: Snapshot?
}

struct Provider: TimelineProvider {
  func placeholder(in context: Context) -> Entry {
    Entry(date: Date(), snapshot: Snapshot.sample)
  }

  func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
    let now = Date()
    let s = snapshot(loadSnapshot(), on: now)
    // The gallery preview shows the real games when there are some.
    completion(Entry(date: now, snapshot: context.isPreview && (s?.games.isEmpty ?? true) ? Snapshot.sample : s))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
    let now = Date()
    markInstalled(context.family, at: now)
    let stored = loadSnapshot()
    var entries = [Entry(date: now, snapshot: snapshot(stored, on: now))]
    let calendar = Calendar.current
    if let midnight = calendar.nextDate(
      after: now, matching: DateComponents(hour: 0, minute: 0), matchingPolicy: .nextTime)
    {
      entries.append(Entry(date: midnight, snapshot: snapshot(stored, on: midnight)))
    }
    let refresh = now.addingTimeInterval(30 * 60)
    completion(Timeline(entries: entries, policy: .after(refresh)))
  }

  /// Tells the app a widget is on the home screen (`widget-installed` flag).
  /// getTimeline runs only for placed widgets, never for gallery previews.
  private func markInstalled(_ family: WidgetFamily, at date: Date) {
    let at = ISO8601DateFormatter().string(from: date)
    var families = Set<String>()
    if let url = groupFileURL(markerFile), let data = try? Data(contentsOf: url),
      let old = try? JSONDecoder().decode([String: String].self, from: data)
    {
      families.formUnion((old["families"] ?? "").split(separator: ",").map(String.init))
    }
    families.insert(familyParam(family))
    let joined = families.sorted().joined(separator: ",")
    if let url = groupFileURL(markerFile),
      let data = try? JSONEncoder().encode(["timelineAt": at, "families": joined])
    {
      try? data.write(to: url, options: .atomic)
    }
    let defaults = UserDefaults(suiteName: appGroup)
    defaults?.set(at, forKey: timelineMarkerKey)
    defaults?.set(joined, forKey: familiesKey)
  }
}

extension Snapshot {
  static let sample = Snapshot(
    v: 1, signedIn: true, day: dayKey(Date()),
    games: [
      SnapshotGame(id: "", name: "MapTap", you: true, played: 3, friends: 5),
      SnapshotGame(id: "", name: "Daily Tens", you: false, played: 2, friends: 4),
      SnapshotGame(id: "", name: "Krillion", you: false, played: 0, friends: 3),
      SnapshotGame(id: "", name: "Globle", you: true, played: 1, friends: 2),
    ],
    more: 0)
}

// MARK: - Views

extension Color {
  static let hsCanvas = Color(red: 0x12 / 255, green: 0x12 / 255, blue: 0x16 / 255)
  static let hsSurface = Color(red: 0x25 / 255, green: 0x1B / 255, blue: 0x36 / 255)
  static let hsPink = Color(red: 0xFF / 255, green: 0x3D / 255, blue: 0x9A / 255)
  static let hsGreen = Color(red: 0xC6 / 255, green: 0xFF / 255, blue: 0x3D / 255)
  static let hsText = Color(red: 0xF2 / 255, green: 0xEF / 255, blue: 0xFA / 255)
  static let hsMuted = Color(red: 0xA9 / 255, green: 0x9E / 255, blue: 0xC2 / 255)
  static let hsDotOff = Color(red: 0x3D / 255, green: 0x2E / 255, blue: 0x55 / 255)
}

/// One dot per friend who has the game, filled for each who posted today.
struct Dots: View {
  let played: Int
  let friends: Int
  let max: Int
  var body: some View {
    let total = Swift.min(Swift.max(friends, played), max)
    let filled = Swift.min(played, total)
    HStack(spacing: 3) {
      ForEach(0..<total, id: \.self) { i in
        Circle()
          .fill(i < filled ? Color.hsGreen : Color.hsDotOff)
          .frame(width: 7, height: 7)
      }
    }
  }
}

struct YouMark: View {
  let you: Bool
  var body: some View {
    if you {
      Image(systemName: "checkmark")
        .font(.system(size: 11, weight: .black))
        .foregroundStyle(Color.hsGreen)
        .accessibilityLabel("You posted")
    } else {
      Text("PLAY")
        .font(.system(size: 9, weight: .heavy, design: .monospaced))
        .foregroundStyle(Color.hsCanvas)
        .padding(.horizontal, 5)
        .padding(.vertical, 2)
        .background(Capsule().fill(Color.hsPink))
        .accessibilityLabel("You haven't posted")
    }
  }
}

/// "2 of 5 played" — the friends who posted today out of the friends who
/// have the game. Short enough for the medium row at any count.
func friendsLine(_ g: SnapshotGame) -> String {
  let of = Swift.max(g.friends, g.played)
  if of == 0 { return "no friends yet" }
  return "\(g.played) of \(of) played"
}

struct Header: View {
  let s: Snapshot
  var body: some View {
    let posted = s.games.filter(\.you).count
    HStack(spacing: 4) {
      Text("TODAY")
        .font(.system(size: 10, weight: .heavy, design: .monospaced))
        .foregroundStyle(Color.hsPink)
      Spacer(minLength: 0)
      Text("\(posted)/\(s.games.count) posted")
        .font(.system(size: 10, weight: .semibold))
        .foregroundStyle(Color.hsMuted)
    }
  }
}

struct Message: View {
  let text: String
  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text("HIGHSCORE")
        .font(.system(size: 11, weight: .heavy, design: .monospaced))
        .foregroundStyle(Color.hsPink)
      Text(text)
        .font(.system(size: 13, weight: .semibold))
        .foregroundStyle(Color.hsText)
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

struct SmallView: View {
  let s: Snapshot
  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Header(s: s)
      ForEach(s.games.prefix(4), id: \.self) { g in
        VStack(alignment: .leading, spacing: 2) {
          HStack(spacing: 4) {
            Text(g.name)
              .font(.system(size: 11, weight: .bold, design: .monospaced))
              .foregroundStyle(Color.hsText)
              .lineLimit(1)
            Spacer(minLength: 0)
            YouMark(you: g.you)
          }
          Dots(played: g.played, friends: g.friends, max: 8)
        }
      }
      Spacer(minLength: 0)
    }
  }
}

struct MediumView: View {
  let s: Snapshot
  let family: WidgetFamily
  var body: some View {
    VStack(alignment: .leading, spacing: 5) {
      Header(s: s)
      ForEach(s.games.prefix(4), id: \.self) { g in
        Link(destination: link(g.id, family)) {
          HStack(spacing: 8) {
            Text(g.name)
              .font(.system(size: 12, weight: .bold, design: .monospaced))
              .foregroundStyle(Color.hsText)
              .lineLimit(1)
              .frame(width: 104, alignment: .leading)
            Dots(played: g.played, friends: g.friends, max: 6)
              .frame(width: 58, alignment: .leading)
            Text(friendsLine(g))
              .font(.system(size: 10, weight: .medium))
              .foregroundStyle(Color.hsMuted)
              .lineLimit(1)
              .minimumScaleFactor(0.8)
            Spacer(minLength: 0)
            YouMark(you: g.you)
          }
        }
      }
      if let more = s.more, more > 0 {
        Text("+\(more) more")
          .font(.system(size: 10, weight: .medium))
          .foregroundStyle(Color.hsMuted)
      }
      Spacer(minLength: 0)
    }
  }
}

struct WidgetView: View {
  let entry: Entry
  @Environment(\.widgetFamily) var family

  var body: some View {
    content
      .containerBackground(for: .widget) { Color.hsCanvas }
  }

  @ViewBuilder var content: some View {
    if let s = entry.snapshot, s.signedIn {
      if s.games.isEmpty {
        Message(text: "Add a game in HighScore to see who's played today.")
          .widgetURL(link(nil, family))
      } else if family == .systemSmall {
        // The whole small widget is one tap: the first game you haven't posted.
        SmallView(s: s)
          .widgetURL(link(s.games.first(where: { !$0.you })?.id, family))
      } else {
        MediumView(s: s, family: family)
          .widgetURL(link(s.games.first(where: { !$0.you })?.id, family))
      }
    } else {
      Message(text: "Open HighScore to see who's played today.")
        .widgetURL(link(nil, family))
    }
  }
}

@main
struct HighScoreTodayWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: widgetKind, provider: Provider()) { entry in
      WidgetView(entry: entry)
    }
    .configurationDisplayName("Who's played today")
    .description("Today's games, which friends have posted, and whether you have.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}
