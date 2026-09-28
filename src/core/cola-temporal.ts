/** Cola acotada; 28 sep 2026: una ráfaga no debe dejar minutos de avisos antiguos. */
export class ColaTemporal<T> {
  private cola: Array<{ valor: T; hasta: number }> = [];
  private activa = false;
  descartados = 0;
  constructor(private consumir: (v: T) => Promise<void>, private fallo: (e: unknown) => void,
    private maximo = 40, private vigenciaMs = 120_000, private ahora = Date.now) {}
  get pendientes(): number { return this.cola.length; }
  encolar(valor: T): boolean {
    this.caducar();
    if (this.cola.length >= this.maximo) { this.descartados++; return false; }
    this.cola.push({ valor, hasta: this.ahora() + this.vigenciaMs });
    if (!this.activa) { this.activa = true; void Promise.resolve().then(() => this.vaciarTrabajo()); }
    return true;
  }
  vaciar(): void { this.cola.length = 0; }
  private caducar(): void {
    while (this.cola.length && this.cola[0]!.hasta <= this.ahora()) { this.cola.shift(); this.descartados++; }
  }
  private async vaciarTrabajo(): Promise<void> {
    try {
      for (;;) {
        this.caducar(); const siguiente = this.cola.shift(); if (!siguiente) break;
        try { await this.consumir(siguiente.valor); } catch (error) { this.fallo(error); }
      }
    } finally { this.activa = false; }
  }
}
