import { createContext, useContext, useEffect } from 'react';

/** Kenar cubugunun alt bolumundeki tek olcu satiri. */
export interface SideStat {
  k: string;
  v: string;
  tone?: 'ok' | 'warn' | 'down';
}

export const SideStatsContext = createContext<(rows: SideStat[]) => void>(() => {});

/**
 * Acik ekranin kendi olcusunu kenar cubuguna yazar.
 *
 * Kenar cubugunda sabit bir sistem durumu yerine BAGLAM duruyor: korpus
 * ekraninda indeksin buyuklugu, denetim ekraninda zincirin butunlugu. Sorulan
 * soru her ekranda farkli oldugu icin cevap da farkli.
 *
 * Bagimlilik olarak dizinin kendisi degil serilesmis hali kullanilir: cagiran
 * her render'da yeni bir dizi uretiyor, referans karsilastirmasi sonsuz
 * donguye girerdi.
 */
export function useSideStats(rows: SideStat[]): void {
  const set = useContext(SideStatsContext);
  const key = JSON.stringify(rows);

  useEffect(() => {
    set(JSON.parse(key) as SideStat[]);
    return () => set([]);
  }, [key, set]);
}
