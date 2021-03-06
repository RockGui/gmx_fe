import React from 'react'

import './Footer.css';

import logoImg from './img/logo.svg'
import twitterIcon from './img/ic_twitter.svg'
import discordIcon from './img/ic_discord.svg'
import telegramIcon from './img/ic_telegram.svg'
import githubIcon from './img/ic_github.svg'
import mediumIcon from './img/ic_medium.svg'

export default function Footer() {
  return(
    <div className="Footer">
      <div className="Footer-wrapper">
        <div className="Footer-logo"><img src={logoImg} alt="MetaMask" />GateChain</div>
        <div className="Footer-social-link-block">
          <a className="App-social-link" href="#" target="_blank" rel="noopener noreferrer">
            <img src={twitterIcon} alt="Twitter" />
          </a>
          <a className="App-social-link" href="#" target="_blank" rel="noopener noreferrer">
            <img src={mediumIcon} alt="Medium" />
          </a>
          <a className="App-social-link" href="#" target="_blank" rel="noopener noreferrer">
            <img src={githubIcon} alt="Github" />
          </a>
          <a className="App-social-link" href="#" target="_blank" rel="noopener noreferrer">
            <img src={telegramIcon} alt="Telegram" />
          </a>
          <a className="App-social-link" href="#" target="_blank" rel="noopener noreferrer">
            <img src={discordIcon} alt="Discord" />
          </a>
        </div>
      </div>
    </div>
  )
}
