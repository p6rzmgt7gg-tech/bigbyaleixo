import { DEFAULT_LOGO_URL } from '../pdf/defaultLogo';
import { useSession } from '../state/session';
import { ImagePicker } from './ImagePicker';

/** Logótipo do canto superior esquerdo do PDF: Medialuso por omissão, ou outro (PNG ou JPG). */
export function LogoPicker() {
  const { state, dispatch } = useSession();
  return (
    <ImagePicker
      label="Logótipo no PDF"
      current={state.logo}
      empty={
        <div className="logo-picker__current">
          <img src={DEFAULT_LOGO_URL} alt="Logótipo Medialuso (por omissão)" />
          <p className="pdf__hint">Por omissão, o logótipo Medialuso.</p>
        </div>
      }
      chooseText="Escolher logótipo"
      replaceText="Trocar logótipo"
      removeText="Repor Medialuso"
      alt="Logótipo escolhido"
      onChange={(image) => dispatch(image ? { type: 'logo-set', logo: image } : { type: 'logo-removed' })}
    />
  );
}

/** Mapa de câmaras do jogo: aparece no PDF entre a logística e as observações. */
export function CameraMapPicker() {
  const { state, dispatch } = useSession();
  return (
    <ImagePicker
      label="Mapa de câmaras"
      current={state.cameraMap}
      empty={<p className="pdf__hint">Sem mapa. Escolha a imagem do mapa de câmaras deste jogo (PNG ou JPG).</p>}
      chooseText="Escolher mapa"
      replaceText="Trocar mapa"
      removeText="Remover"
      alt="Mapa de câmaras"
      onChange={(image) => dispatch(image ? { type: 'camera-map-set', image } : { type: 'camera-map-removed' })}
    />
  );
}
