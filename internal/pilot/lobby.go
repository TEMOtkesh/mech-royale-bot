package pilot

// Lobby reading. Scored practice is us against a squad of house bots that cooperate and hunt us;
// real matches are a free-for-all where the others also kill each other. Deaths we did not cause
// give a free-for-all away. Until the opening is over we assume nothing and play carefully.

type lobby struct {
	deadSeen    int
	killsSeen   int
	unexplained int
	ffa         bool
	creditT     float64 // last time we damaged a mech
	creditID    int
}

// noteHit records that we damaged mech id (a death right after may be ours without a kill event).
func (p *Pilot) noteHit(id int) {
	if id < 100 {
		p.lob.creditT, p.lob.creditID = p.now, id
	}
}

// readLobby updates the free-for-all evidence from the alive count.
func (p *Pilot) readLobby() {
	l := &p.lob
	total := int(p.cfg.Match.Get("mechs", 16))
	dead := total - p.o.Alive
	if dead <= l.deadSeen {
		return
	}
	n := dead - l.deadSeen
	l.deadSeen = dead
	switch {
	case p.kills > l.killsSeen:
		n -= p.kills - l.killsSeen
		l.killsSeen = p.kills
	case p.now-l.creditT < 6:
		// we were shooting someone; the death is probably that one finished off by something else,
		// unless we can see it alive right now
		if c := p.contacts[l.creditID]; c == nil || !c.Listed || c.HP <= 0 {
			n--
		}
	}
	if n > 0 {
		l.unexplained += n
	}
	if (l.unexplained >= 1 && p.now < 35) || (l.unexplained >= 2 && p.now < 110) || l.unexplained >= 3 {
		l.ffa = true
	}
}

// practice reports whether we take this to be the house squad.
func (p *Pilot) practice() bool { return !p.lob.ffa && p.now >= p.T.OpeningSecs }
