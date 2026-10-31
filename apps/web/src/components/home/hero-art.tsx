import type { ArtPalette } from "./season-content.ts";

/** Flat seasonal illustration of a house, yard and driveway, re-coloured per season. */
export function HeroArt({ art }: { art: ArtPalette }) {
  return (
    <svg
      viewBox="0 0 520 340"
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
      focusable="false"
      className="season-art block"
    >
      <rect x="0" y="0" width="520" height="340" fill={art.sky} />
      <g opacity={art.raysOp} stroke={art.sun} strokeWidth="3" strokeLinecap="round" fill="none">
        <path d="M462 66V56M462 150V160M420 108H410M504 108H514M432 78L425 71M492 138L499 145M432 138L425 145M492 78L499 71" />
      </g>
      <circle cx="462" cy="108" r="26" fill={art.sun} opacity={art.sunOp} />
      <g opacity={art.cloudOp} fill="#FFFFFF">
        <ellipse cx="96" cy="114" rx="34" ry="12" />
        <ellipse cx="120" cy="105" rx="22" ry="14" />
        <ellipse cx="350" cy="100" rx="26" ry="9" />
        <ellipse cx="368" cy="94" rx="16" ry="10" />
      </g>
      <path d="M0 236C70 214 150 218 230 230C320 244 420 206 520 222V340H0Z" fill={art.hill} />
      <path d="M0 268C130 256 330 252 520 262V340H0Z" fill={art.ground} />
      <g opacity={art.stripesOp} fill="rgba(255,255,255,0.2)">
        <path d="M0 290L52 282L30 340H0Z" />
        <path d="M100 276L150 272L132 340H76Z" />
        <path d="M440 266L490 268L520 300V340H500Z" />
      </g>
      <path d="M240 288H262L278 340H222Z" fill={art.walk} />
      <path d="M336 284H392L474 340H316Z" fill={art.drive} />
      <g opacity={art.snowOp} fill="#FFFFFF" stroke="#BCD0E0" strokeWidth="1.5">
        <ellipse cx="320" cy="324" rx="12" ry="18" />
        <ellipse cx="330" cy="298" rx="8" ry="11" />
        <ellipse cx="458" cy="326" rx="22" ry="11" />
        <ellipse cx="420" cy="302" rx="14" ry="7" />
      </g>
      <path d="M80 150L116 214H100L122 256H38L60 214H44Z" fill="#2E6B4F" />
      <rect x="74" y="256" width="12" height="20" fill="#6B4E3D" />
      <g opacity={art.snowOp} fill="#FFFFFF">
        <path d="M80 150L92 171C86 167 74 167 68 171Z" />
        <path d="M46 213C66 207 94 207 114 213L113 217C94 212 66 212 47 217Z" />
        <path d="M40 255C62 249 98 249 120 255L119 259C98 254 62 254 41 259Z" />
      </g>
      <g stroke="#6B4E3D" strokeLinecap="round" fill="none">
        <path d="M472 300V196" strokeWidth="9" />
        <path
          d="M472 238L448 214M472 224L494 200M472 208L460 178M472 208L486 174"
          strokeWidth="4"
        />
      </g>
      <g opacity={art.canopyOp}>
        <circle cx="444" cy="194" r="28" fill={art.canopy2} />
        <circle cx="500" cy="192" r="28" fill={art.canopy2} />
        <circle cx="472" cy="172" r="40" fill={art.canopy} />
      </g>
      <g opacity={art.flowersOp} fill="#F2B8C9">
        <circle cx="458" cy="160" r="4" />
        <circle cx="486" cy="176" r="4" />
        <circle cx="470" cy="148" r="3" />
        <circle cx="446" cy="190" r="4" />
        <circle cx="498" cy="198" r="3" />
        <circle cx="478" cy="192" r="3" />
      </g>
      <rect x="282" y="132" width="16" height="44" fill="#8A5A44" />
      <rect x="279" y="127" width="22" height="8" rx="4" fill="#FFFFFF" opacity={art.snowOp} />
      <rect x="156" y="192" width="168" height="82" fill="#FBF8F1" />
      <path d="M134 196L240 122L346 196Z" fill="#33403A" />
      <path
        d="M134 196L240 122L346 196H330C318 188 300 192 290 184L240 150L190 184C180 192 162 188 150 196Z"
        fill="#FFFFFF"
        opacity={art.snowOp}
      />
      <rect x="146" y="195" width="188" height="5" rx="2.5" fill="#8C968F" />
      <rect x="172" y="214" width="38" height="30" rx="3" fill={art.window} />
      <rect x="270" y="214" width="38" height="30" rx="3" fill={art.window} />
      <path
        d="M191 214V244M172 229H210M289 214V244M270 229H308"
        stroke="#FBF8F1"
        strokeWidth="2.5"
      />
      <rect x="168" y="244" width="46" height="4" rx="2" fill="#CFC8BA" />
      <rect x="266" y="244" width="46" height="4" rx="2" fill="#CFC8BA" />
      <rect x="224" y="222" width="32" height="52" rx="4" fill="#1E5B43" />
      <circle cx="250" cy="250" r="2" fill="#F5F6F1" />
      <rect x="152" y="270" width="176" height="6" fill="#CFC8BA" />
      <rect x="218" y="276" width="44" height="12" rx="2" fill="#D9D2C4" />
      <ellipse cx="186" cy="276" rx="24" ry="10" fill={art.shrub} />
      <ellipse cx="296" cy="276" rx="24" ry="10" fill={art.shrub} />
      <g opacity={art.flowersOp}>
        <circle cx="172" cy="268" r="4" fill="#E58BA8" />
        <circle cx="186" cy="265" r="4" fill="#F2C14E" />
        <circle cx="200" cy="268" r="4" fill="#E58BA8" />
        <circle cx="282" cy="268" r="4" fill="#F2C14E" />
        <circle cx="296" cy="265" r="4" fill="#E58BA8" />
        <circle cx="310" cy="268" r="4" fill="#F2C14E" />
      </g>
      <rect x="330" y="290" width="92" height="36" rx="9" fill="#1E5B43" />
      <path d="M398 294H410A8 8 0 0 1 418 302V308H398Z" fill="#CFE1D8" />
      <path d="M346 314c0-7 4.5-10.5 11-10.5 0 7-4.5 10.5-11 10.5z" fill="#FFFFFF" />
      <circle cx="350" cy="328" r="8" fill="#18211D" />
      <circle cx="402" cy="328" r="8" fill="#18211D" />
      <circle cx="350" cy="328" r="3" fill="#9AA39D" />
      <circle cx="402" cy="328" r="3" fill="#9AA39D" />
      <path d="M424 302L438 298V332L424 328Z" fill="#E0A23A" opacity={art.snowOp} />
      <g opacity={art.leavesOp}>
        <ellipse cx="470" cy="304" rx="30" ry="7" fill="#C9662B" />
        <ellipse cx="150" cy="292" rx="22" ry="6" fill="#D9822B" />
        <ellipse cx="420" cy="134" rx="6" ry="3" transform="rotate(30 420 134)" fill="#C2571F" />
        <ellipse cx="380" cy="182" rx="5" ry="2.6" transform="rotate(-20 380 182)" fill="#E0A040" />
        <ellipse cx="506" cy="250" rx="6" ry="3" transform="rotate(40 506 250)" fill="#B4451C" />
        <ellipse cx="436" cy="244" rx="5" ry="2.5" transform="rotate(10 436 244)" fill="#D9822B" />
        <ellipse cx="404" cy="226" rx="5" ry="2.5" transform="rotate(-40 404 226)" fill="#C2571F" />
        <ellipse cx="140" cy="128" rx="5" ry="2.5" transform="rotate(-35 140 128)" fill="#E0A040" />
      </g>
      <g opacity={art.snowOp} fill="#FFFFFF">
        {SNOWFLAKES.map(([cx, cy, r]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} />
        ))}
      </g>
    </svg>
  );
}

const SNOWFLAKES: ReadonlyArray<readonly [number, number, number]> = [
  [40, 96, 3],
  [110, 80, 2.5],
  [170, 122, 3],
  [222, 86, 2.5],
  [300, 108, 3],
  [352, 78, 2.5],
  [402, 140, 3],
  [500, 72, 2.5],
  [30, 190, 2.5],
  [150, 162, 3],
  [250, 96, 2],
  [330, 152, 2.5],
  [420, 190, 3],
  [505, 150, 2.5],
  [200, 150, 2],
  [372, 232, 2.5],
  [130, 212, 2],
];
