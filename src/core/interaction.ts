import type { Viewer } from './events.js';
import type { SendOutcome } from './output.js';

/**
 * El contrato de una interacción.
 *
 * FASE 7. Sale del inventario de docs/05-NOTAS-PARA-EL-MOTOR.md, escrito con
 * las tres primeras interacciones ya construidas. No se diseñó antes a
 * propósito: la regla del proyecto es tres casos reales antes de abstraer
 * (docs/03 § 2), porque un motor inventado obliga a reescribir lo que abstrae.
 *
 * La idea de todo esto cabe en una frase: **una interacción decide QUÉ decir;
 * el motor se encarga de todo lo demás.** Comprobar guardas, consumir
 * cooldowns, enviar, y dejar constancia en la base de datos no son asunto de
 * la interacción, y hasta ahora los tres archivos los repetían.
 */

/**
 * Resultado de una comprobación: o pasa, o pasa nada y se dice por qué.
 *
 * `registrar` decide si el descarte deja fila en la base de datos, y por
 * defecto NO la deja. La diferencia importa más de lo que parece:
 *
 *  - "no aplica" (no es su primer mensaje, no vuelve de ninguna ausencia) le
 *    pasa a CADA mensaje del chat. Registrarlo llenaría la tabla de ruido
 *    hasta hacerla inútil.
 *  - "aplicaba pero se rechaza" (pregunta vacía, pregunta larguísima) es
 *    justo lo que quieres poder mirar después. Eso lleva `registrar: true`.
 */
export type Verdict = { ok: true } | { ok: false; motivo: string; registrar?: boolean };

/**
 * Lo mínimo que el motor necesita saber de cualquier contexto.
 *
 * Cada interacción define el suyo, más rico, y el motor solo toca estos dos
 * campos. `trigger` es una cadena libre porque una misma interacción puede
 * tener varios: `pregunta-ia` responde a `command` y a `channel-point`, y
 * necesita distinguirlos para decidir si aplica los cooldowns.
 */
export interface Ctx {
  viewer: Viewer;
  trigger: string;
}

/**
 * Un cooldown.
 *
 * Es una LISTA, no uno solo, y esa es una de las lecciones del inventario:
 * `pregunta-ia` tiene dos (por usuario y global) y hay que comprobarlos todos
 * antes de consumir ninguno. Si se consumen a medida que se comprueban, el
 * primero se gasta aunque el segundo bloquee.
 *
 * `applies` existe porque un disparador puede eximir: quien paga puntos de
 * canal recibe respuesta aunque el comando gratuito esté en cooldown.
 */
export interface CooldownSpec<C extends Ctx> {
  key: (ctx: C) => string;
  ms: number;
  /** El texto que se registra cuando este cooldown bloquea. */
  motivo: (ctx: C, faltanSegundos: number) => string;
  /** Si falta, el cooldown se aplica siempre. */
  applies?: (ctx: C) => boolean;
}

/**
 * Lo que una interacción quiere decir.
 *
 * `detail` recibe el resultado del envío porque lo que se registra depende de
 * si salió o no, y cada interacción lo cuenta a su manera: `pregunta-ia`
 * apunta el coste y la latencia, `bienvenida-vuelta` los días de ausencia.
 * Unificarlo habría sido perder información útil.
 */
export interface Salida {
  text: string;
  /** true solo si el texto lo escribió Claude: decide si pasa por revisión. */
  aiGenerated?: boolean;
  allowedMentions?: string[];
  detail?: (outcome: SendOutcome) => string | null;
}

export interface Interaction<C extends Ctx> {
  name: string;

  /**
   * ¿Habla sin que nadie la invoque?
   *
   * Las espontáneas las apaga `INTERACCIONES_ESPONTANEAS`. Que esto viva en
   * el contrato y no en el manejador es lo que permite apagarlas todas de
   * golpe sin tocar ninguna interacción.
   */
  spontaneous: boolean;

  /**
   * Solo consulta (!inventario, !top…): no cambia nada. Con el techo de
   * respuestas casi agotado, cede el hueco a las acciones (ver policy.ts).
   */
  consulta?: boolean;

  /**
   * Se comprueban EN ORDEN y la primera que falle descarta la interacción.
   * El motivo se registra una sola vez; antes se escribía dos veces por
   * guarda, una para el log y otra para la base de datos, y ya habían
   * divergido.
   */
  guards?: Array<(ctx: C) => Verdict>;

  cooldowns?: Array<CooldownSpec<C>>;

  /** Devolver null significa "al final no hay nada que decir". */
  run: (ctx: C) => Promise<Salida | null> | Salida | null;

  /**
   * Última oportunidad de adornar el motivo de un descarte.
   *
   * Existe por `pregunta-ia`, que prefija todos los suyos con el disparador
   * (`command: pregunta vacía`) porque tiene dos y hay que saber cuál fue.
   */
  describeSkip?: (motivo: string, ctx: C) => string;
}

/**
 * El registro más común: nada si salió bien, y el motivo del rechazo si no.
 *
 * Lo usan las interacciones que no tienen nada especial que contar. Está aquí
 * y no copiado en cada una porque era, literalmente, el bloque más repetido
 * de los tres archivos originales.
 */
export function detalleEstandar(outcome: SendOutcome): string | null {
  if (outcome.sent) return outcome.dryRun ? 'dry-run' : null;
  return `${outcome.rejection}: ${outcome.detail}`;
}
