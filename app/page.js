import { redirect } from 'next/navigation';

// Quem acessa o endereço raiz sempre cai na landing page.
// A área logada fica em /meus-mapas.
export default function Page() {
  redirect('/landingpage');
}
