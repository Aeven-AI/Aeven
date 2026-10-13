/** Browser entry for the Web client. */
import './aeven-fonts.css'
import { AppWebEntry } from '@aeven/client-web'

const el = document.getElementById('root')
if (el === null) throw new Error('web app: missing #root')
void new AppWebEntry(el).run()
