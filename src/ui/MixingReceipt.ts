import type { MortarBatch } from '../systems/MortarBatch';

/** Passive bucket receipt: acknowledge deposits, never loads still on a tool. */
export class MixingReceipt {
  private readonly panel: HTMLElement;
  private readonly amounts: HTMLElement[];
  private readonly status: HTMLElement;
  private previous = [0, 0, 0];
  private remaining = 0;
  private message = '';
  private key = '';
  private readonly number = new Intl.NumberFormat('el-GR', { maximumFractionDigits: 1 });

  constructor(shell: HTMLElement) {
    this.panel = document.createElement('section');
    this.panel.id = 'mixing-receipt';
    this.panel.hidden = true;
    this.panel.setAttribute('aria-label', 'Υλικά που μπήκαν στη σύκλα');
    this.panel.innerHTML = '<b class="mix-receipt-title">ΣΤΗ ΣΥΚΛΑ</b><dl><div><dt>Νερό</dt><dd data-ingredient="water">0 L</dd></div><div><dt>Τσιμέντο</dt><dd data-ingredient="cement">0 μιστριές</dd></div><div><dt>Άμμος</dt><dd data-ingredient="sand">0 φτυαριές</dd></div></dl><p role="status" aria-live="polite" aria-atomic="true"></p>';
    this.amounts = Array.from(this.panel.querySelectorAll('dd'));
    this.status = this.panel.querySelector('p')!;
    shell.append(this.panel);
  }

  update(batch: MortarBatch, visible: boolean, dt: number): void {
    const values = [batch.waterLitres, batch.cementScoops, batch.sandScoops];
    this.remaining = Math.max(0, this.remaining - dt);
    const additions: string[] = [];
    values.forEach((value, index) => {
      const added = value - this.previous[index];
      if (added <= 1e-6) return;
      const amount = this.number.format(added);
      additions.push(index === 0 ? `${amount} L νερό` : index === 1
        ? `${amount} ${Math.abs(added - 1) < 1e-6 ? 'μιστριά' : 'μιστριές'} τσιμέντο`
        : `${amount} ${Math.abs(added - 1) < 1e-6 ? 'φτυαριά' : 'φτυαριές'} άμμο`);
    });
    if (additions.length) {
      this.message = `✓ Στη σύκλα: +${additions.join(' · +')}`;
      this.remaining = 4.5;
    } else if (values.some((value, index) => value < this.previous[index] - 1e-6)) {
      this.remaining = 0;
    }
    this.previous = values;
    if (this.panel.hidden === visible) this.panel.hidden = !visible;
    const labels = [`${this.number.format(values[0])} L`,
      `${this.number.format(values[1])} ${Math.abs(values[1] - 1) < 1e-6 ? 'μιστριά' : 'μιστριές'}`,
      `${this.number.format(values[2])} ${Math.abs(values[2] - 1) < 1e-6 ? 'φτυαριά' : 'φτυαριές'}`];
    const status = this.remaining > 0 ? this.message : batch.ready ? 'Έτοιμο · η ανάμιξη ολοκληρώθηκε' : 'Οι ποσότητες ενημερώνονται όταν αδειάσεις το εργαλείο.';
    const key = JSON.stringify([...labels, status, this.remaining > 0]);
    if (key === this.key) return;
    this.key = key;
    labels.forEach((label, index) => { if (this.amounts[index].textContent !== label) this.amounts[index].textContent = label; });
    if (this.status.textContent !== status) this.status.textContent = status;
    this.panel.classList.toggle('has-deposit', this.remaining > 0);
  }
}
