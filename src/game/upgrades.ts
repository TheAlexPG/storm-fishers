import type { UpgradeId, UpgradeLevels } from '../core/types';
import { L } from '../core/i18n';

// ─────────────────────────────────────────────────────────────
// 9 дерев апгрейдів × 5 рівнів. Правило: жодного «невидимого»
// апгрейду — кожен рівень це конкретна річ, що стоїть на полиці
// крамниці й після купівлі з'являється на човні (моделі —
// world/upgradeParts.ts).
// ─────────────────────────────────────────────────────────────

export interface UpgradePart {
  name: string;
  blurb: string;
}

export interface UpgradeStat {
  label: string;
  value: (lvl: number) => number;
  fmt: (v: number) => string;
  /** менше — краще (напр. крен) */
  lowerBetter?: boolean;
}

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  /** коротко, що дає дерево загалом */
  role: string;
  desc: (lvl: number) => string;
  costs: number[]; // вартість рівнів 1..5
  parts: UpgradePart[]; // речі рівнів 1..5
  stats: UpgradeStat[];
  /** відкривається лише після іншого апгрейду (мід-гейм) */
  requires?: { id: UpgradeId; lvl: number };
}

/** топова швидкість під мотором (стенд фізики: опір ~ v², тож швидкість росте повільніше за потужність) */
const motorKmh = (l: number) => 27 * Math.pow(1 + l * 0.2, 0.55);

const pct = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)} %`;

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'engine',
    name: L('Двигун', `Engine`),
    role: L('швидкість під мотором', `speed under power`),
    desc: (l) => L(`+${l * 20} % потужності (${Math.round(motorKmh(l))} км/год)`, `+${l * 20} % power (${Math.round(motorKmh(l))} km/h)`),
    costs: [400, 800, 1600, 3200, 6000],
    parts: [
      { name: L('Вихлоп із нержавійки', `Stainless exhaust`), blurb: L('Широкий патрубок у транці — мотор дихає вільніше й бурчить басовитіше.', `A wide outlet in the transom — the engine breathes easier and rumbles deeper.`) },
      { name: L('Вентиляційні грибки', `Mushroom vents`), blurb: L('Пара класичних дефлекторів на кормі: холодне повітря в моторний відсік.', `A pair of classic cowl vents on the stern: cool air for the engine bay.`) },
      { name: L('Кожух із жалюзі', `Louvred cover`), blurb: L('Люк моторного відсіку з жалюзі в підлозі кокпіту. Тепло виходить, бризки — ні.', `A louvred engine hatch in the cockpit floor. Heat gets out, spray doesn't.`) },
      { name: L('Подвійний вихлоп', `Twin exhaust`), blurb: L('Другий патрубок у транці. Симетрично, гучно, ефективно.', `A second outlet in the transom. Symmetric, loud, efficient.`) },
      { name: L('Турбонаддув', `Turbocharger`), blurb: L('Турбіна й висока хромована труба біля кокпіту. Видно здалеку — і чути теж.', `A turbo and a tall chrome stack by the cockpit. You can see it from afar — and hear it too.`) },
    ],
    stats: [
      { label: L('Швидкість під мотором', `Speed under power`), value: motorKmh, fmt: (v) => L(`${Math.round(v)} км/год`, `${Math.round(v)} km/h`) },
      { label: L('Потужність', `Power`), value: (l) => l * 20, fmt: pct },
    ],
  },
  {
    id: 'hull',
    name: L('Корпус', `Hull`),
    role: L('міцність проти хвиль і скель', `strength against waves and rocks`),
    desc: (l) => L(`+${l * 40} міцності (макс. ${100 + l * 40})`, `+${l * 40} strength (max ${100 + l * 40})`),
    costs: [350, 700, 1400, 2800, 5000],
    parts: [
      { name: L('Гумовий привальний брус', `Rubber rubbing strake`), blurb: L('Чорний гумовий кант уздовж борту. Причал більше не дряпає гелькоут.', `A black rubber strip along the side. The pier no longer scratches the gelcoat.`) },
      { name: L('Накладка на форштевень', `Stem plate`), blurb: L('Блискуча сталева смуга на носі — розрізає хвилю й плавуче сміття.', `A shiny steel strip on the bow — it cuts through waves and floating debris.`) },
      { name: L('Броньовий пояс', `Armour belt`), blurb: L('Сталевий пояс уздовж борту над ватерлінією. Ударів хвиль майже не чути.', `A steel belt along the side above the waterline. You barely hear the waves hit.`) },
      { name: L('Скулові плити', `Bow plates`), blurb: L('Клепані сталеві плити на носових скулах — там, куди б\'є найсильніше.', `Riveted steel plates on the bow shoulders — right where it hits hardest.`) },
      { name: L('Сталевий фальшборт', `Steel bulwark`), blurb: L('Високий борт на баку: хвиля розбивається об сталь, а не об тебе.', `A high bulwark on the foredeck: the wave breaks on steel, not on you.`) },
    ],
    stats: [{ label: L('Міцність корпусу', `Hull strength`), value: (l) => 100 + l * 40, fmt: (v) => `${Math.round(v)}` }],
  },
  {
    id: 'hold',
    name: L('Трюм', `Hold`),
    role: L('скільки риби влазить', `how much fish fits`),
    desc: (l) => L(`місткість ${8 + l * 6} шт.`, `capacity ${8 + l * 6} pcs`),
    costs: [300, 600, 1200, 2400, 4500],
    parts: [
      { name: L('Рибний ящик', `Fish box`), blurb: L('Синій пластиковий ящик із кришкою. Стоїть у кормі кокпіту.', `A blue plastic box with a lid. It sits at the back of the cockpit.`) },
      { name: L('Другий ящик', `Second box`), blurb: L('Пара до першого — з правого борту.', `A partner for the first one — on the starboard side.`) },
      { name: L('Холодильник', `Cooler`), blurb: L('Білий кулер на ящику: риба довше лишається свіжою на вигляд.', `A white cooler on the box: the fish looks fresh for longer.`) },
      { name: L('Кофр на дугу', `Arch box`), blurb: L('Обтічний бокс на кормовій дузі між сонячними панелями. Пахне рибою, але місткий.', `A streamlined box on the stern arch between the solar panels. Smells of fish, but it holds a lot.`) },
      { name: L('Сітка-садок', `Keep net`), blurb: L('Велика сітка на баку для вилову, що не влазить нікуди більше.', `A big net on the foredeck for the catch that fits nowhere else.`) },
    ],
    stats: [{ label: L('Місткість трюму', `Hold capacity`), value: (l) => 8 + l * 6, fmt: (v) => L(`${Math.round(v)} шт.`, `${Math.round(v)} pcs`) }],
  },
  {
    id: 'rod',
    name: L('Вудка', `Rod`),
    role: L('далекий закид і міцна волосінь', `long casts and strong line`),
    desc: (l) => L(`закид до ${Math.round(8 + l * 1.2)} м, швидший клюв, міцніша леска`, `cast up to ${Math.round(8 + l * 1.2)} m, faster bites, stronger line`),
    costs: [300, 650, 1300, 2600, 4800],
    parts: [
      { name: L('Котушка «Шторм»', `“Storm” reel`), blurb: L('Велика хромована котушка на твою вудку. Закидає далі, змотує рівно.', `A big chrome reel for your rod. Casts further, winds evenly.`) },
      { name: L('Плетена волосінь', `Braided line`), blurb: L('Яскраво-помаранчева плетінка на бобіні. Видно навіть у сутінках.', `Bright orange braid on a spool. You can see it even at dusk.`) },
      { name: L('Підсак', `Landing net`), blurb: L('Сітка на довгій ручці біля носового релінгу — велика риба вже не зривається біля борту.', `A net on a long handle by the bow rail — big fish no longer slip off at the side.`) },
      { name: L('Ехолот', `Fish finder`), blurb: L('Маленький екран на пульпіті: видно зграї під човном, риба клює швидше.', `A small screen on the console: you see schools under the boat, fish bite faster.`) },
      { name: L('Карбонове вудлище', `Carbon rod`), blurb: L('Легке чорне вудлище з золотою котушкою — для тунця й акули.', `A light black rod with a golden reel — for tuna and shark.`) },
    ],
    stats: [
      { label: L('Дальність закиду', `Cast distance`), value: (l) => 8 + l * 1.2, fmt: (v) => L(`${v.toFixed(1).replace('.', L(',', '.'))} м`, `${v.toFixed(1).replace('.', L(',', '.'))} m`) },
      { label: L('Швидкість клювання', `Bite speed`), value: (l) => l * 8, fmt: pct },
      { label: L('Міцність волосіні', `Line strength`), value: (l) => l * 15, fmt: pct },
    ],
  },
  {
    id: 'fuel',
    name: L('Паливний бак', `Fuel tank`),
    role: L('як далеко зайдеш на моторі', `how far you can go under power`),
    desc: (l) => L(`об'єм ${40 + l * 100} л`, `volume ${40 + l * 100} l`),
    costs: [250, 500, 1000, 2000, 3800],
    parts: [
      { name: L('Дві каністри', `Two jerrycans`), blurb: L('Червоні каністри по бортах біля кокпіту.', `Red jerrycans on both sides by the cockpit.`) },
      { name: L('Ще дві каністри', `Two more jerrycans`), blurb: L('Поруч із першими. Запах бензину — запах свободи.', `Next to the first ones. The smell of petrol is the smell of freedom.`) },
      { name: L('Стелаж для каністр', `Jerrycan rack`), blurb: L('Сталевий стелаж уздовж борту й третя пара каністр.', `A steel rack along the side and a third pair of cans.`) },
      { name: L('Повний стелаж', `Full rack`), blurb: L('Четверта пара — стелаж заповнено.', `A fourth pair — the rack is full.`) },
      { name: L('Додатковий бак', `Extra tank`), blurb: L('Великий бак на даху рубки. Тепер можна йти за горизонт.', `A big tank on the cabin roof. Now you can go past the horizon.`) },
    ],
    stats: [{ label: L("Об'єм палива", `Fuel volume`), value: (l) => 40 + l * 100, fmt: (v) => L(`${Math.round(v)} л`, `${Math.round(v)} l`) }],
  },
  {
    id: 'lights',
    name: L('Світло палуби', `Deck lights`),
    role: L('видимість уночі', `visibility at night`),
    desc: (l) => L(`світло: ${l === 0 ? L('одна фара', `one light`) : l < 4 ? L(`${l + 1} ліхтарі`, `${l + 1} lights`) : L('4 ліхтарі + прожектор', `4 lights + searchlight`)}`, `light: ${l === 0 ? L('одна фара', `one light`) : l < 4 ? L(`${l + 1} ліхтарі`, `${l + 1} lights`) : L('4 ліхтарі + прожектор', `4 lights + searchlight`)}`),
    costs: [200, 450, 900, 1800, 3500],
    parts: [
      { name: L('Носовий ліхтар', `Bow lantern`), blurb: L('Латунний ліхтар на носовому релінгу. Тепле світло над баком.', `A brass lantern on the bow rail. Warm light over the foredeck.`) },
      { name: L('Ліхтар рубки (лівий)', `Cabin-top light (port)`), blurb: L('Ліхтар на даху рубки з лівого борту.', `A light on the cabin roof, port side.`) },
      { name: L('Ліхтар рубки (правий)', `Cabin-top light (starboard)`), blurb: L('Пара до лівого — палуба освітлена з обох боків.', `A partner for the port one — the deck is lit on both sides.`) },
      { name: L('Ліхтар кокпіту', `Cockpit light`), blurb: L('Ліхтар на кормовій дузі: світло над штурвалом і ящиками.', `A light on the stern arch: light over the wheel and the boxes.`) },
      { name: L('Пошуковий прожектор', `Searchlight`), blurb: L('Потужний прожектор на щоглі над гіком — б\'є на 40 метрів уперед.', `A powerful searchlight on the mast above the boom — it reaches 40 metres ahead.`) },
    ],
    stats: [
      { label: L('Ліхтарів на палубі', `Deck lights`), value: (l) => Math.min(4, l), fmt: (v) => `${Math.round(v)}` },
      { label: L('Радіус світла', `Light radius`), value: (l) => 6 + l * 3, fmt: (v) => L(`${Math.round(v)} м`, `${Math.round(v)} m`) },
    ],
  },
  {
    id: 'stab',
    name: L('Стабілізатор', `Stabiliser`),
    role: L('менше хитає у хвилю', `less rolling in the waves`),
    desc: (l) => L(`−${Math.round((1 - 1 / (1 + l * 0.3)) * 100)} % крену`, `−${Math.round((1 - 1 / (1 + l * 0.3)) * 100)} % roll`),
    costs: [500, 1000, 2000, 4000, 7500],
    parts: [
      { name: L('Гіроскоп', `Gyroscope`), blurb: L('Гіростабілізатор під куполом на кормі. Тихо гуде й гасить крен.', `A gyro-stabiliser under a dome at the stern. It hums quietly and damps the roll.`) },
      { name: L('Плавники-стабілізатори', `Stabiliser fins`), blurb: L('Невеликі плавники по бортах біля ватерлінії.', `Small fins on both sides near the waterline.`) },
      { name: L('Сервоприводи', `Servo drives`), blurb: L('Приводи плавників під кожухами на бічних палубах — плавники працюють активно.', `Fin actuators under covers on the side decks — the fins work actively.`) },
      { name: L('Великі плавники', `Big fins`), blurb: L('Плавники вдвічі більші. Човен іде як по рейках.', `Fins twice as big. The boat runs as if on rails.`) },
      { name: L('Другий гіроскоп', `Second gyroscope`), blurb: L('Ще один купол поруч із першим. Крен — що це?', `Another dome next to the first. Roll — what's that?`) },
    ],
    stats: [{ label: L('Крен у хвилю', `Roll in waves`), value: (l) => -(1 - 1 / (1 + l * 0.3)) * 100, fmt: (v) => (v === 0 ? '0 %' : `${Math.round(v)} %`), lowerBetter: true }],
  },
  {
    id: 'holders',
    name: L('Стійки для вудок', `Rod holders`),
    role: L('кілька вудок одночасно', `several rods at once`),
    desc: (l) => L(`${holderCount(l)} ${holderCount(l) === 1 ? L('вудка', `rod`) : L('вудки', `rods`)} в стійках${l >= 3 ? L(', дзвіночки', `, bells`) : ''}`, `${holderCount(l)} ${holderCount(l) === 1 ? L('вудка', `rod`) : L('вудки', `rods`)} in holders${l >= 3 ? L(', дзвіночки', `, bells`) : ''}`),
    costs: [350, 700, 1300, 2600, 4600],
    parts: [
      { name: L('Стійка й спінінг', `Holder and spinning rod`), blurb: L('Тримач на лівому борту зі спінінгом. Закинь — і вудка сама чекає: клює — біжи підсікати.', `A holder on the port rail with a spinning rod. Cast it and the rod waits on its own: when it bites — run and strike.`) },
      { name: L('Друга стійка й донка', `Second holder and bottom rod`), blurb: L('Тримач на правому борту з важкою донкою — тепер дві вудки в воді, окрім твоєї.', `A holder on the starboard rail with a heavy bottom rod — now two rods are in the water besides yours.`) },
      { name: L('Дзвіночки', `Bells`), blurb: L('Латунні дзвіночки на кінчиках: чути клювання з будь-якого кінця човна, риба тримається довше.', `Brass bells on the rod tips: you hear a bite from anywhere on the boat, and the fish stays on longer.`) },
      { name: L('Котушки з тріскачкою', `Clicker reels`), blurb: L('Тріскачка на котушках стійок — клює частіше, на троллінгу ловить більшу рибу.', `Clickers on the holder reels — more bites, and bigger fish when trolling.`) },
      { name: L('Троллінгова вудка на транці', `Trolling rod on the transom`), blurb: L('Третя стійка на кормі з товстою троллінговою вудкою — для великої риби на ходу.', `A third holder at the stern with a thick trolling rod — for big fish under way.`) },
    ],
    stats: [
      { label: L('Вудок у стійках', `Rods in holders`), value: (l) => holderCount(l), fmt: (v) => `${Math.round(v)}` },
      { label: L('Час на підсічку', `Time to strike`), value: (l) => holderBiteWindow(l), fmt: (v) => L(`${v.toFixed(0)} с`, `${v.toFixed(0)} s`) },
      { label: L('Швидкість клювання', `Bite speed`), value: (l) => (holderBiteSpeed(l) - 1) * 100, fmt: pct },
    ],
  },
  {
    id: 'sails',
    name: L('Паруси', `Sails`),
    role: L('швидкість і гострота під вітрилами', `speed and pointing under sail`),
    desc: (l) => {
      const p = sailPerf(l);
      return L(`тяга +${Math.round((p.drive - 1) * 100)} %, мертвий кут ${p.noGo}°${p.genn ? L(', генакер на повних курсах', `, gennaker on broad reaches`) : ''}`, `drive +${Math.round((p.drive - 1) * 100)} %, no-go angle ${p.noGo}°${p.genn ? L(', генакер на повних курсах', `, gennaker on broad reaches`) : ''}`);
    },
    costs: [450, 900, 1800, 3600, 6800],
    parts: [
      { name: L('Нові дакронові паруси', `New Dacron sails`), blurb: L('Сліпучо-білий дакрон із синьою смугою: парус тримає форму — більше тяги, менше крену.', `Dazzling white Dacron with a blue stripe: the sail holds its shape — more drive, less heel.`) },
      { name: L('Ролик і лебідки', `Furler and winches`), blurb: L('Великий барабан ролика на штагу й пара хромованих лебідок із самостопором на рубці: риф і постановка — вдвічі швидше.', `A big furling drum on the forestay and a pair of self-tailing chrome winches on the coachroof: reefing and hoisting twice as fast.`) },
      { name: L('Ламіновані паруси', `Laminate sails`), blurb: L('Сріблясто-золотий ламінат із волокнами по лініях навантаження: човен іде гостріше до вітру й не полощеться.', `Silver-gold laminate with fibres along the load paths: the boat points higher and doesn't luff.`) },
      { name: L('Бушприт і генакер', `Bowsprit and gennaker`), blurb: L('Карбоновий бушприт на носі й синьо-жовтий генакер: сам розкривається на повних курсах і тягне, як паровоз.', `A carbon bowsprit and a blue-and-yellow gennaker: it opens by itself on broad reaches and pulls like a locomotive.`) },
      { name: L('Гоночний карбоновий пакет', `Carbon racing package`), blurb: L('Чорні карбонові паруси, карбоновий гік і вітромір на топі: найгостріший курс і запас на шквал.', `Black carbon sails, a carbon boom and a masthead wind vane: the highest pointing and a margin for squalls.`) },
    ],
    stats: [
      { label: L('Тяга під парусом', `Drive under sail`), value: (l) => (sailPerf(l).drive - 1) * 100, fmt: pct },
      { label: L('Мертвий кут до вітру', `No-go angle to the wind`), value: (l) => sailPerf(l).noGo, fmt: (v) => `${Math.round(v)}°`, lowerBetter: true },
      { label: L('Запас на шквал', `Squall margin`), value: (l) => (sailPerf(l).over - 1) * 100, fmt: pct },
      { label: L('Постановка / риф', `Hoist / reef`), value: (l) => 3 / sailPerf(l).hoist, fmt: (v) => L(`${v.toFixed(1).replace('.', L(',', '.'))} с`, `${v.toFixed(1).replace('.', L(',', '.'))} s`), lowerBetter: true },
    ],
  },
  {
    id: 'nets',
    name: L('Сітки', `Nets`),
    role: L('промисловий лов: сітки з буями', `commercial fishing: nets with buoys`),
    desc: (l) => L(`${netCount(l)} ${netCount(l) === 1 ? L('сітка', `net`) : L('сітки', `nets`)} по ${netLength(l)} м`, `${netCount(l)} ${netCount(l) === 1 ? L('сітка', `net`) : L('сітки', `nets`)} of ${netLength(l)} m`),
    costs: [2400, 4200, 6800, 9800, 14500],
    requires: { id: 'hold', lvl: 2 },
    parts: [
      { name: L('Ставна сітка й буї', `Set net and buoys`), blurb: L('Ящик зі сіткою на кормовій платформі й два буї з прапорцями. Постав сітку на ходу — і повертайся за уловом через кілька годин.', `A net box on the stern platform and two flagged buoys. Set the net under way — and come back for the catch a few hours later.`) },
      { name: L('Сіткопідйомник', `Net hauler`), blurb: L('Сталевий ролик на транці: сітку вибирати втричі легше, а на борту — друга сітка.', `A steel roller on the transom: hauling is three times easier, and there's a second net aboard.`) },
      { name: L('Довгі сітки', `Long nets`), blurb: L('Сітки по 70 м і високі буї-віхи з прапорами — видно здалеку, ловлять удвічі більше.', `70 m nets and tall flagged dan buoys — visible from afar, they catch twice as much.`) },
      { name: L('Сітковий барабан', `Net drum`), blurb: L('Гідравлічний барабан над платформою: сітка йде за борт і вертається сама. Третя сітка в комплекті.', `A hydraulic drum over the platform: the net goes out and comes back by itself. A third net included.`) },
      { name: L('Глибоководний дрифтер', `Deep-water drifter`), blurb: L('Корма-рама зі шківом і 110-метрові глибоководні сітки — у відкритому морі приносять палтуса й тунця.', `A stern gantry with a sheave and 110-metre deep-water nets — in the open sea they bring halibut and tuna.`) },
    ],
    stats: [
      { label: L('Сіток', `Nets`), value: (l) => netCount(l), fmt: (v) => `${Math.round(v)}` },
      { label: L('Довжина сітки', `Net length`), value: (l) => netLength(l), fmt: (v) => L(`${Math.round(v)} м`, `${Math.round(v)} m`) },
      { label: L('Швидкість вибирання', `Hauling speed`), value: (l) => (netHaulSpeed(l) - 1) * 100, fmt: pct },
    ],
  },
  {
    id: 'instr',
    name: L('Прилади', `Instruments`),
    role: L('від латунного компаса до радара', `from a brass compass to radar`),
    desc: (l) => INSTR_DESC[Math.max(0, Math.min(5, l))],
    costs: [300, 900, 2200, 4200, 8000],
    parts: [
      { name: L('Пульт механічних приладів', `Mechanical gauge console`), blurb: L('Пульт на тумбі штурвала: тахометр, покажчик палива й латунний барометр (лаг переїжджає на пульт). Барометр попередить про шторм.', `A console on the helm pedestal: tachometer, fuel gauge and a brass barometer (the log moves onto the console). The barometer warns of storms.`) },
      { name: L('Ехолот і вітромір', `Depth sounder and wind gauge`), blurb: L('Електронний дисплей: глибина під кілем із сигналом мілини, вимпельний і справжній вітер, цифрові показники.', `An electronic display: depth under the keel with a shallow alarm, apparent and true wind, digital readouts.`) },
      { name: L('GPS-картплотер', `GPS chartplotter`), blurb: L('Кольоровий екран із картою навколо яхти й твоїм маршрутом. Точний курс, відстань і час до точки, маршрут на мінікарті.', `A colour screen with the chart around the yacht and your route. Exact bearing, distance and time to the waypoint, the route on the minimap.`) },
      { name: L('Ехолот-рибошукач', `Fish-finding sonar`), blurb: L('Сонар показує рибу під кілем і рельєф дна, а на компасі з\'являється стрілка до найближчої зграї.', `The sonar shows fish under the keel and the seabed, and an arrow to the nearest school appears on the compass.`) },
      { name: L('Радар і AIS', `Radar and AIS`), blurb: L('Обтічник радара на щоглі, екран зі скелями й човнами, імена суден на мінікарті.', `A radome on the mast, a screen with rocks and boats, vessel names on the minimap.`) },
    ],
    stats: [
      { label: L('Приладів біля штурвала', `Instruments at the helm`), value: (l) => [4, 6, 8, 9, 10, 12][Math.max(0, Math.min(5, l))], fmt: (v) => `${Math.round(v)}` },
      { label: L('Точність навігації', `Navigation accuracy`), value: (l) => (l >= 3 ? 1 : l >= 1 ? 0.5 : 0.25) * 100, fmt: (v) => `${Math.round(v)} %` },
    ],
  },
  {
    id: 'tent',
    name: L('Тент', `Canvas`),
    role: L('м\'яка парусина над кокпітом — знімається будь-коли', `soft canvas over the cockpit — take it off any time`),
    desc: (l) => TENT_DESC[Math.max(0, Math.min(5, l))],
    costs: [450, 1100, 2200, 3400, 5600],
    parts: [
      { name: L('Козирок над трапом', `Sprayhood`), blurb: L('Брезентовий козирок на обручах з віконцями з прозорого вінілу. Бризки й дощ не летять у відчинені двері каюти.', `A canvas sprayhood on hoops with clear vinyl windows. Spray and rain don't fly in through the open cabin doors.`) },
      { name: L('Біміні', `Bimini`), blurb: L('Тент на нержавіючих обручах від кормової дуги над штурвалом, з віконцем на грот — паруси видно й з-під нього. Укриття від дощу й сонця.', `An awning on stainless hoops from the stern arch over the wheel, with a window for the mainsail — you can still see the sails from under it. Shelter from rain and sun.`) },
      { name: L('Штори кокпіту', `Cockpit curtains`), blurb: L('Бічні полотна з вікнами й вставка до козирка: у шторм опускаєш (E на рулоні) — кокпіт сухий, хвиля менше заливає палубу.', `Side panels with windows and a link to the sprayhood: lower them in a storm (E at the roll) — the cockpit stays dry and waves wash the deck less.`) },
      { name: L('Затишний кокпіт', `Cosy cockpit`), blurb: L('Подушки на лавах і тепла гірлянда під біміні: під тентом сили відновлюються, як у каюті.', `Cushions on the benches and a warm string of lights under the bimini: under the canvas you recover energy like in the cabin.`) },
      { name: L('Штормовий тент', `Storm canvas`), blurb: L('Важка «дубова» парусина з подвійним швом: опущені штори тримають майже всю воду, корпус не просочується в шторм.', `Heavy “oak” canvas with double seams: lowered curtains keep out almost all the water, and the hull doesn't leak in a storm.`) },
    ],
    stats: [
      { label: L('Захист трапа', `Companionway protection`), value: (l) => (l >= 1 ? 65 : 0), fmt: (v) => `${Math.round(v)} %` },
      { label: L('Укриття кокпіту', `Cockpit shelter`), value: (l) => [0, 5, 45, 90, 90, 100][Math.max(0, Math.min(5, l))], fmt: (v) => `${Math.round(v)} %` },
    ],
  },
  {
    id: 'pump',
    name: L('Помпа', `Bilge pump`),
    role: L('відкачування трюму — від ручної до автоматичної', `pumping the bilge — from manual to automatic`),
    desc: (l) => PUMP_DESC[Math.max(0, Math.min(5, l))],
    costs: [300, 700, 1500, 2600, 4200],
    parts: [
      { name: L('Двоплунжерна помпа', `Double-action pump`), blurb: L('Качає на обидва ходи важеля: трюм осушується в півтора раза швидше, руки втомлюються менше.', `Pumps on both strokes of the lever: the bilge drains one and a half times faster and your arms tire less.`) },
      { name: L('Велика помпа з довгим важелем', `Big pump with a long lever`), blurb: L('Ширший циліндр і довгий важіль — удвічі швидше за стару ручну помпу.', `A wider cylinder and a long lever — twice as fast as the old hand pump.`) },
      { name: L('Електропомпа з поплавцем', `Electric pump with float switch`), blurb: L('Поплавець сам вмикає помпу, щойно в трюмі набирається вода: відкачує й тоді, коли ти за штурвалом. Пульт «AUTO» біля помпи.', `A float switch turns the pump on as soon as water collects in the bilge: it keeps pumping while you're at the wheel. An “AUTO” panel by the pump.`) },
      { name: L('Друга електропомпа', `Second electric pump`), blurb: L('Ще одна помпа з власним виливом у транці — автоматика відкачує вдвічі швидше.', `Another pump with its own outlet in the transom — the automatic system pumps twice as fast.`) },
      { name: L('Аварійна помпа високої продуктивності', `High-capacity emergency pump`), blurb: L('Потужна помпа з аварійною лампою: автоматика втричі швидша й зганяє воду ще й з палуби.', `A powerful pump with an alarm lamp: the automatic system is three times faster and clears water off the deck too.`) },
    ],
    stats: [
      { label: L('Ручне качання', `Hand pumping`), value: (l) => pumpManual(l) * 100, fmt: (v) => `${Math.round(v)} %` },
      { label: L('Автоматика', `Automatic`), value: (l) => pumpAuto(l), fmt: (v) => (v > 0 ? L(`${Math.round(v)} %/с`, `${Math.round(v)} %/s`) : '—') },
    ],
  },
  {
    // окремий модуль (не рівень «Приладів»): веде маршрутом GPS, тож потрібні прилади ≥ 3
    id: 'autopilot',
    name: L('Автопілот', `Autopilot`),
    role: L('сам веде яхту маршрутом або тримає курс', `steers the yacht along the route or holds course`),
    desc: (l) => (l >= 1 ? L('блок біля штурвала: T або кнопка — увімк./вимк.', `unit at the helm: T or the button — on/off`) : L('кермуєш сам', `you steer yourself`)),
    costs: [3600],
    requires: { id: 'instr', lvl: 3 },
    parts: [
      { name: L('Блок автопілота', `Autopilot unit`), blurb: L('Румпельний привод і пульт біля штурвала. Веде яхту маршрутом із GPS-картплотера або тримає поточний курс; кермо (A/D) чи T — вимкнути.', `A wheel drive and a control head at the helm. Steers along the GPS chartplotter route or holds the current course; rudder (A/D) or T — off.`) },
    ],
    stats: [
      { label: L('Автокерування', `Self-steering`), value: (l) => (l >= 1 ? 1 : 0), fmt: (v) => (v ? L('так', `yes`) : '—') },
    ],
  },
];

/** помпа: множник ручного качання (швидкість і менше сил на хід) */
export const pumpManual = (l: number) => 1 + 0.5 * Math.min(2, Math.max(0, l));
/** помпа: автоматика з поплавцем, % трюму за секунду (з рівня 3) */
export const pumpAuto = (l: number) => (l >= 3 ? 4 * (l - 2) : 0);

const PUMP_DESC = [
  L('ручна помпа — качаєш сам', `hand pump — you pump it yourself`),
  L('двоплунжерна — у півтора раза швидше', `double-action — one and a half times faster`),
  L('довгий важіль — удвічі швидше', `long lever — twice as fast`),
  L('+ автоматична електропомпа з поплавцем', `+ automatic electric pump with float switch`),
  L('+ друга електропомпа — автоматика вдвічі швидша', `+ second electric pump — the automatic system twice as fast`),
  L('+ аварійна помпа — втричі швидше, зганяє воду й з палуби', `+ emergency pump — three times faster, clears the deck too`),
];

/** «Тент»: що стоїть над кокпітом на кожному рівні */
const TENT_DESC = [
  L('відкритий кокпіт — паруси як на долоні', `open cockpit — the sails in full view`),
  L('козирок над трапом', `sprayhood over the companionway`),
  L('+ біміні над штурвалом', `+ bimini over the wheel`),
  L('+ штори кокпіту (опускаються в негоду)', `+ cockpit curtains (lowered in foul weather)`),
  L('+ подушки й гірлянда — затишок', `+ cushions and string lights — cosiness`),
  L('+ штормова парусина з подвійним швом', `+ storm canvas with double seams`),
];

/** «Прилади»: що видно на пульті на кожному рівні */
const INSTR_DESC = [
  L('компас, лаг, вітромір і анемометр — механіка', `compass, log, wind gauge and anemometer — mechanical`),
  L('+ пульт: тахометр, паливо, барометр', `+ console: tachometer, fuel, barometer`),
  L('+ ехолот глибини й вітромір', `+ depth sounder and wind gauge`),
  L('+ GPS-картплотер з маршрутом', `+ GPS chartplotter with route`),
  L('+ рибошукач і стрілка до зграї', `+ fish finder and an arrow to the school`),
  L('+ радар і AIS', `+ radar and AIS`),
];

/** які можливості дає рівень «Приладів» */
export function instrHas(l: number) {
  return {
    /** пульт: тахометр, паливо, барометр (лаг і компас є з рівня 0) */
    gauges: l >= 1,
    /** глибина, вітромір, цифри на екрані */
    depth: l >= 2,
    /** GPS: точний курс/відстань/час, маршрут на мінікарті */
    gps: l >= 3,
    /** сонар: риба під кілем, стрілка до зграї */
    sonar: l >= 4,
    /** радар, AIS, автопілот */
    radar: l >= 5,
  };
}

/**
 * Паруси: що дає кожен рівень (читає SailRig).
 *  drive — множник тяги, noGo — мертвий кут (°), hoist — швидкість лебідки/ролика,
 *  heel — множник крену від вітру, over — запас до перевантаження (шквал),
 *  genn — є генакер для повних курсів.
 */
export interface SailPerf {
  drive: number;
  noGo: number;
  hoist: number;
  heel: number;
  over: number;
  genn: boolean;
}
const SAIL_PERF: SailPerf[] = [
  { drive: 1.0, noGo: 28, hoist: 1.2, heel: 1.0, over: 1.0, genn: false },
  { drive: 1.12, noGo: 27, hoist: 1.2, heel: 0.9, over: 1.06, genn: false },
  { drive: 1.12, noGo: 27, hoist: 2.4, heel: 0.9, over: 1.1, genn: false },
  { drive: 1.24, noGo: 23, hoist: 2.4, heel: 0.85, over: 1.15, genn: false },
  { drive: 1.24, noGo: 23, hoist: 2.4, heel: 0.85, over: 1.15, genn: true },
  { drive: 1.32, noGo: 21, hoist: 2.8, heel: 0.75, over: 1.45, genn: true },
];
export function sailPerf(l: number): SailPerf {
  return SAIL_PERF[Math.max(0, Math.min(5, Math.round(l)))];
}

/** сітки: скільки можна поставити одночасно */
export function netCount(l: number): number {
  return [0, 1, 2, 2, 3, 4][Math.max(0, Math.min(5, l))];
}
/** довжина однієї сітки, м */
export function netLength(l: number): number {
  return l >= 5 ? 110 : l >= 3 ? 70 : l >= 1 ? 40 : 0;
}
/** множник швидкості вибирання сітки */
export function netHaulSpeed(l: number): number {
  return l >= 4 ? 2.6 : l >= 2 ? 1.7 : 1;
}

/** чому апгрейд ще не можна купити (null — можна) */
export function upgradeLock(id: UpgradeId, levels: UpgradeLevels): string | null {
  const r = UPGRADE_BY_ID[id]?.requires;
  if (!r || (levels[r.id] ?? 0) >= r.lvl) return null;
  return L(`спершу ${UPGRADE_BY_ID[r.id].name.toLowerCase()} рів. ${r.lvl}`, `first ${UPGRADE_BY_ID[r.id].name.toLowerCase()} lvl ${r.lvl}`);
}

/** скільки вудок у стійках на рівні */
export function holderCount(l: number): number {
  return l >= 5 ? 3 : l >= 2 ? 2 : l >= 1 ? 1 : 0;
}
/** скільки секунд риба тримається на гачку в стійці, поки біжиш */
export function holderBiteWindow(l: number): number {
  return l >= 3 ? 9 : 6;
}
export function holderBiteSpeed(l: number): number {
  return l >= 4 ? 1.35 : 1;
}

export const UPGRADE_BY_ID: Record<string, UpgradeDef> = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));
export const MAX_LEVEL = 5;
/** скільки рівнів у дерева (автопілот — один модуль) */
export const maxLevel = (id: UpgradeId): number => UPGRADE_BY_ID[id]?.costs.length ?? MAX_LEVEL;

export function defaultUpgrades(): UpgradeLevels {
  return { engine: 0, hull: 0, hold: 0, rod: 0, fuel: 0, lights: 0, stab: 0, holders: 0, sails: 0, nets: 0, instr: 0, tent: 0, pump: 0, autopilot: 0 };
}

export function upgradeCost(id: UpgradeId, currentLevel: number): number | null {
  const def = UPGRADE_BY_ID[id];
  if (!def || currentLevel >= def.costs.length) return null;
  return def.costs[currentLevel];
}

// ── Ефекти (читає фізика/ігри) ──
export const eff = {
  enginePower: (l: number) => 1 + l * 0.2,
  maxHull: (l: number) => 100 + l * 40,
  holdCap: (l: number) => 8 + l * 6,
  castDist: (l: number) => 8 + l * 1.2,
  biteSpeed: (l: number) => 1 + l * 0.08,
  lineStrength: (l: number) => 1 + l * 0.15,
  maxFuel: (l: number) => 40 + l * 100,
  lightRadius: (l: number) => 6 + l * 3,
  rollDamp: (l: number) => 1 + l * 0.3,
};
