# Έρευνα ψαθυρής καταστροφής τοιχοποιίας

Ημερομηνία έρευνας: **2026-09-13**, Asia/Nicosia.

Πεδίο: πραγματική αλληλεπίδραση κατεδαφιστικού πιστολέτου και καλεμιού με κοίλη κεραμική τοιχοποιία, αρμούς και επίχρισμα. Το αρχείο τεκμηριώνει την έρευνα· δεν αποτελεί δήλωση ότι η υλοποίηση ή τα acceptance tests ολοκληρώθηκαν. Η σύγκριση αλγορίθμων του συγκεκριμένου runtime και η τελική αρχιτεκτονική προστίθενται χωριστά από την έρευνα υλικών.

## Συμπέρασμα και όρια

Το κατάλληλο ορατό αποτέλεσμα είναι τοπική σύνθλιψη, μικρά chips, ρωγμές, αποκόλληση και μόνιμη απώλεια υλικού. Χρειάζονται προϋπάρχοντα κοίλα κελιά, χωριστές εσωτερικές νευρώσεις και ανεξάρτητη συνδεσιμότητα κελύφους, νευρώσεων και κονιάματος. Η υποχώρηση ολόκληρης συνδεδεμένης επιφάνειας προς τα πίσω με τεντωμένα τρίγωνα δεν αποδίδει αυτόν τον μηχανισμό.

Η προσομοίωση παιχνιδιού είναι **ποιοτική, μη βαθμονομημένη μηχανική προσέγγιση**. Δεν έχουν μετρηθεί το συγκεκριμένο κυπριακό τούβλο, το πάχος κάθε κελύφους, οι αντοχές, η υγρασία, η πραγματική ενέργεια μεταφοράς ή τα χαρακτηριστικά του εργαλείου των φωτογραφιών. Δεν βρέθηκε μία πρωτογενής μελέτη που να μετρά και τις οκτώ ζητούμενες θέσεις κρούσης με pointed/flat καλέμια στο ίδιο κοίλο κεραμικό μπλοκ. Παρακάτω διακρίνονται άμεσο εύρημα, φυσική αναλογία και engineering inference. Δεν παρουσιάζονται πειράματα γυαλιού, γρανίτη, σκυροδέματος ή στατικής φόρτισης ως δοκιμές του συγκεκριμένου υλικού σε κατεδάφιση.

## Πρωτογενείς πηγές και εφαρμόσιμα ευρήματα

### 1. Κεραμικό τούβλο και κονίαμα: προοδευτικές ρωγμές

Το Πανεπιστήμιο Minho περιγράφει clay brick, mortar και συναφή υλικά ως quasi-brittle: οι εσωτερικές μικρορωγμές αναπτύσσονται προοδευτικά, επιταχύνονται κοντά στο μέγιστο φορτίο και καταλήγουν σε ασταθείς μακρορωγμές. Το softening της μηχανικής είναι η μείωση της αντίστασης καθώς εξελίσσεται η θραύση, όχι μαλακή μεταλλική λακκούβα. Η μελέτη παρουσιάζει δοκιμές μονοαξονικού εφελκυσμού σε τούβλα και διεπιφάνειες τούβλου/κονιάματος.

- [Barros, Almeida, Lourenço, Characterization of brick and brick–mortar interface under uniaxial tension, 2002](https://hdl.handle.net/1822/12775)
- [Καταχώριση RCAAP με αναλυτική περίληψη](https://www.rcaap.pt/detail.jsp?id=oai%3Arepositorium.uminho.pt%3A1822%2F12775)
- Πρόσβαση: η αναλυτική indexed περίληψη διαβάστηκε. Η επόμενη απευθείας φόρτωση RCAAP επέστρεψε anti-bot σελίδα· δεν διεκδικείται ανάγνωση μη προσβάσιμου πλήρους κειμένου.

Εφαρμογή: διατήρηση ιστορικού βλάβης, διαφορετικό κατώφλι έναρξης ρωγμών και αποκόλλησης, μόνιμη απώλεια υλικού.

### 2. Αιχμηρή επαφή: ζώνη βλάβης και συστήματα ρωγμών

Η NIST παρουσιάζει συγκεντρωμένη βλάβη κάτω από αιχμηρά indenters, καθώς και median, radial και lateral cracks. Διαφορετικές γεωμετρίες διεισδυτή δίνουν διαφορετικά συστήματα ρωγμών. Πρόκειται για κεραμικά και γυαλιά μικρής κλίμακας, όχι δοκιμή εργοταξιακού καλεμιού σε μπλοκ.

- [NIST Recommended Practice Guide: Fractography of Ceramics and Glasses, §7.12](https://nvlpubs.nist.gov/nistpubs/specialpublications/nist.sp.960-16e2.pdf)

Εφαρμογή ως φυσική αναλογία: μικρή ζώνη επαφής/σύνθλιψης, ρωγμές πέρα από το αφαιρεμένο υλικό, προσανατολισμός που εξαρτάται από την κόψη. Δεν αντιγράφονται αριθμητικές σταθερές από μικροδοκιμές.

### 3. Ακμές, spalling και ξαφνική απελευθέρωση

Οι Chai και Lawn κατέγραψαν πειράματα σε γυαλί και λεπτόκοκκα κεραμικά με αιχμηρή επαφή κοντά σε ακμή. Οι ρωγμές αναπτύσσονται και καμπυλώνονται προς την ελεύθερη επιφάνεια, γίνονται ασταθείς και απελευθερώνουν scallop-like θραύσμα. Η απόσταση από την ακμή και η δυσθραυστότητα επηρεάζουν το απαιτούμενο φορτίο. Η εργασία επισημαίνει επιπλέον ότι αποφόρτιση και επαναφόρτιση μπορούν να επιταχύνουν ρωγμές μέσω υπολειμματικών τάσεων και κόπωσης.

- [A universal relation for edge chipping from sharp contacts in brittle materials, Acta Materialia 55, 2007](https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=850142)
- DOI: `10.1016/j.actamat.2006.10.061`.
- Πρόσβαση: πλήρες επτασέλιδο PDF, περιγραφή πειραμάτων, εξέλιξη ρωγμών και περιορισμοί.

Εφαρμογή: οι υπάρχουσες ακμές και τα ανοίγματα επηρεάζουν την επόμενη θραύση. Ένα προηγουμένως εξασθενημένο κομμάτι μπορεί να απελευθερωθεί από μικρή επιπλέον βλάβη. Οι αριθμητικές εξισώσεις γυαλιού δεν μεταφέρονται αυτούσιες στο παιχνίδι.

### 4. Επαναλαμβανόμενη επαφή και ετερογένεια κεραμικών

Η ανασκόπηση NIST διακρίνει cone cracking από διάχυτες υποεπιφανειακές ζώνες βλάβης ανάλογα με τη μικροδομή. Εξετάζει απώλεια αντοχής και συσσώρευση βλάβης σε κυκλική επαφή. Δεν ισχυρίζεται ότι όλα τα κεραμικά έχουν ίδια απόκριση.

- [Lawn, Indentation of Ceramics with Spheres: A Century After Hertz, 1998](https://www.nist.gov/publications/indentation-ceramics-spheres-century-after-hertz)

Εφαρμογή: η τυχαιότητα μπορεί να αναπαριστά ετερογένεια και προϋπάρχοντα ελαττώματα· δεν πρέπει να μηδενίζει τη βλάβη ή να ξανακληρώνει έναν άσχετο κρατήρα κάθε χτύπημα.

### 5. Κρουστική εκσκαφή: σύνθλιψη και chipping

Πειράματα κρουστικής διείσδυσης πετρώματος διακρίνουν σύνθλιψη κοντά στην επαφή και ρωγμές στην ευρύτερη περιοχή. Μεταβάλλοντας το σχήμα του διεισδυτή αλλάζουν βάθος, επιφάνεια και όγκος εκσκαφής.

- [Jiang et al., Experimental and Numerical Investigation of Hard Rock Breakage by Indenter Impact, 2020](https://onlinelibrary.wiley.com/doi/10.1155/2020/2747830)

Άλλη πειραματική εργασία σε Kuru granite εξηγεί ότι chips μπορούν να σχηματιστούν όταν πλευρικές ρωγμές συναντήσουν γειτονικές ρωγμές ή ελεύθερο όριο. Η αφαίρεση δεν περιορίζεται στην κονιοποίηση κάτω από τον διεισδυτή.

- [Experimental and numerical study of drill bit drop tests on Kuru granite](https://pmc.ncbi.nlm.nih.gov/articles/PMC5179971/)
- Πρόσβαση: indexed περίληψη/εισαγωγή· η επαναφόρτωση πλήρους σελίδας επέστρεψε CAPTCHA.

Εφαρμογή αποκλειστικά ως αναλογία: χωρικό πεδίο επαφής, νέες ρωγμές που συνδέονται με υπάρχουσα βλάβη, διακριτή παραγωγή μικρής σκόνης και μεγαλύτερων αποκολλώμενων κομματιών. Τα ενεργειακά δεδομένα πετρώματος δεν χρησιμοποιούνται ως αντοχή κεραμικού τούβλου.

### 6. Πραγματικά κοίλα τούβλα

Η Brick Industry Association διακρίνει face shells, cross/end webs και cells και περιγράφει διαφορετικές διατάξεις κονιάματος: έδραση στα κελύφη και, σε συγκεκριμένες συνθήκες, κονίαμα σε webs ή πλήρη κλίνη. Η εσωτερική διάταξη δεν ισοδυναμεί με συμπαγή πορτοκαλί όγκο ούτε με ένα μόνο κενό.

- [BIA Technical Note 41: Hollow Brick Masonry](https://www.gobrick.com/media/file/41-hollow-brick-masonry.pdf)

Οι διαστάσεις και οι εφαρμογές BIA δεν ταυτίζονται αναγκαστικά με τα τούβλα των φωτογραφιών. Η πηγή τεκμηριώνει την ανατομία και την ανεξάρτητη θέση κονιάματος, ενώ η οπτική διάταξη πρέπει να ελέγχεται με τις αναφορές του χρήστη.

### 7. Κονίαμα και διεπιφάνειες

Πρωτογενείς δοκιμές soft-brick masonry με διαφορετικά κονιάματα και προθλίψεις δείχνουν εξέλιξη ρωγμών στη διεπιφάνεια και υπολειμματική τριβή μετά την απώλεια συνοχής. Τα επίπεδα αστοχίας εξαρτώνται από το κονίαμα και τη φόρτιση.

- [Ravula & Subramaniam, Experimental Investigation and Interface Material Model for the Cohesive–Frictional Shear Response of Soft-Brick Masonry under Applied Compression, 2019](https://ascelibrary.org/doi/10.1061/%28ASCE%29MT.1943-5533.0002961)

Πειράματα shear σε red-clay brick triplets με τσιμεντοκονιάματα και ασβεστοκονιάματα χρησιμοποιούν Acoustic Emission και Digital Image Correlation για τον εντοπισμό θραύσης και συγκέντρωσης παραμόρφωσης πριν από τη μακροσκοπική ρωγμή.

- [Shear failure characterization in masonry components made with different mortars based on combined NDT methods, 2019](https://www.sciencedirect.com/science/article/pii/S0950061819314849)

Εφαρμογή: το κονίαμα έχει χωριστά χαρακτηριστικά και συνδέσεις. Δεν δικαιολογείται ο καθολικός κανόνας «το κονίαμα διαγράφεται πάντα πριν από τον πηλό». Υπολείμματα μπορούν να μένουν συνδεδεμένα με γειτονικό/βαθύτερο υλικό αφού αποκοπεί πηλός. Η συγκεκριμένη μορφή αυτών των υπολειμμάτων είναι engineering inference και οπτική παρατήρηση, όχι μετρημένο αποτέλεσμα κρούσης των παραπάνω δοκιμών.

### 8. Επίχρισμα/render

Πρωτογενείς δοκιμές τοίχων με τσιμεντοειδές επίχρισμα καταγράφουν ρηγμάτωση και αποκόλληση από το υπόστρωμα· ο δεσμός και η κατάσταση του υποστρώματος επηρεάζουν την απόκριση. Οι δοκιμές είναι συνολικής φόρτισης τοίχου, όχι τοπικού καλεμιού.

- [Effect of Thin Cement-Based Renders on the Structural Response of Masonry Wall Panels, 2018](https://www.mdpi.com/2076-3417/8/1/98)

Εφαρμογή: ανεξάρτητη λεπτή γκρι στρώση με δική της βλάβη/αποκόλληση, ορατό πάχος στα σπασμένα χείλη και διαφορετικά θραύσματα. Οι παράμετροι «λεπτό/ασθενές επίχρισμα» της εργασίας είναι προδιαγραφή παιχνιδιού· δεν αποτελούν καθολική ιδιότητα κάθε πραγματικού render.

## Σύγκριση καλεμιών

Η Hilti διακρίνει pointed για heavy demolition, narrow-flat για controlled breaking, wide-flat για surface work και masonry chisels για mortar channels. Περιγράφει επίσης επίδραση ειδικής polygon γεωμετρίας στη δημιουργία ρωγμών.

- [Hilti Demolition Hammers / Chisels selector](https://www.hilti.com/content/dam/urgent-folder/w1/pdf/drilling-and-demolition/W1_us_en_breaker_selector_supplement_combined.pdf)

Η Bosch επιβεβαιώνει χρήση επίπεδου καλεμιού σε concrete/brick και δημοσιεύει τη γραμμική κόψη του συγκεκριμένου εργαλείου.

- [Bosch PRO HEX 22-5C Flat Chisel](https://www.bosch-professional.com/gb/en/pro-hex-22-5c-flat-chisel-3095414-ocs-ac/)

Ο παρακάτω πίνακας συνδυάζει την τεκμηριωμένη διάκριση εφαρμογών των κατασκευαστών με ποιοτική μηχανική ερμηνεία. Δεν αποτελεί μετρημένη σύγκριση ίσης ενέργειας στο τούβλο των φωτογραφιών.

| Παράμετρος | Αιχμηρό/pointed | Επίπεδο/flat |
|---|---|---|
| Αρχική επαφή | Μικρή συγκεντρωμένη περιοχή | Προσανατολισμένη γραμμική κόψη |
| Διείσδυση | Συγκεντρωμένη τοπική δράση | Εξάρτηση από πλάτος, γωνία και επαφή της κόψης |
| Διάδοση ρωγμών | Περισσότερο ακτινική/πολυκατευθυντική έναρξη | Κατευθυντική προτίμηση σχετική με την κόψη |
| Επιφανειακή αφαίρεση | Τοπικό σπάσιμο και άνοιγμα νέας περιοχής | Ελεγχόμενο πλευρικό chipping, ειδικά σε εκτεθειμένη ακμή |
| Δημιουργία chase | Ακολουθία τοπικών επαφών/διορθώσεων | Προσανατολισμένη αφαίρεση κατά μήκος εργασίας του παίκτη |
| Μέγεθος θραύσματος | Καθορίζεται και από γεωμετρία/βλάβη/στήριξη | Καθορίζεται και από γεωμετρία/βλάβη/στήριξη |

Δεν χρησιμοποιείται απόλυτος κανόνας «pointed = μικρά θραύσματα, flat = μεγάλα». Το πάχος, οι κυψέλες, οι ελεύθερες επιφάνειες, οι παλιές ρωγμές και οι υπόλοιποι δεσμοί καθορίζουν τι μπορεί να αποκολληθεί. Η περιστροφή flat κόψης πρέπει να αλλάζει το πεδίο δράσης, όχι μόνο το διακοσμητικό μοντέλο.

## Σύγκριση θέσεων κρούσης

**Engineering inference από τους παραπάνω μηχανισμούς και τις φωτογραφίες.** Δεν παρουσιάζεται ως οκτώ ανεξάρτητα βαθμονομημένα πειράματα.

| Θέση | Ποιοτικά αναμενόμενη διαφοροποίηση | Συνέπεια για το παιχνίδι |
|---|---|---|
| Κέντρο μπλοκ | Το κέντρο της πρόσοψης από μόνο του δεν καθορίζει αν από πίσω υπάρχει κενό ή νεύρωση | Εξέταση τρέχουσας γεωμετρίας στην επαφή, όχι bonus damage βάσει ID |
| Πάνω από κοίλη κυψέλη | Το λεπτό κέλυφος μπορεί να σπάσει και να αποκαλύψει υπάρχον κενό ενώ τα πλάγια στηρίγματα επιβιώνουν | Ανεξάρτητο shell failure, ορατή κυψέλη και εναπομείνασες νευρώσεις |
| Πάνω από νεύρωση | Περισσότερη τοπική στήριξη και διαφορετική διαδρομή τάσεων/ρωγμών | Διαφορετικό κατώφλι/τοπολογία, βλάβη σε shell–rib κόμβο όπου αρμόζει |
| Ακμή μονάδας ή κοιλότητας | Η ελεύθερη επιφάνεια επιτρέπει ρωγμή και αποκόλληση προς αυτήν | Ασύμμετρο chipping, όχι τέλειος σφαιρικός κρατήρας |
| Γωνία | Περισσότερες ελεύθερες επιφάνειες και μικρότερη πλευρική συγκράτηση | Αποκοπή γωνιώδους τμήματος με διατήρηση της υπόλοιπης μονάδας |
| Κονίαμα | Σύνθλιψη κονιάματος, ρήξη δεσμού και πιθανή βλάβη γειτονικού πηλού | Ανεξάρτητο υλικό και μεταβλητά υπολείμματα |
| Διασταύρωση πολλών μονάδων | Ένα πεδίο κρούσης μπορεί να περιλαμβάνει διαφορετικά υλικά και μονάδες | Το spatial query δεν σταματά στα σύνορα brick IDs |
| Ήδη ραγισμένη περιοχή | Οι παλιές ρωγμές και τα υπολείμματα στήριξης μεταβάλλουν την επόμενη αστοχία | Συσσώρευση βλάβης και πιθανή απελευθέρωση μεγαλύτερου εξασθενημένου τμήματος |

### Γιατί επιβιώνουν κέλυφος, νευρώσεις ή κονίαμα επιλεκτικά

- Το μπροστινό κέλυφος πάνω από κενό μπορεί να χάσει τη συνέχεια χωρίς να έχουν σπάσει τα στηρίγματα γύρω από την κυψέλη.
- Διαφορετικές νευρώσεις δέχονται διαφορετική τοπική βλάβη και έχουν διαφορετικές υπόλοιπες συνδέσεις. Δεν χρειάζεται να αποτύχουν όλες μαζί.
- Το κενό δεν είναι στερεός δεσμός. Η ρωγμή μπορεί να τερματίσει σε ελεύθερη επιφάνεια ή να συνεχιστεί μέσω άλλου εναπομείναντος υλικού· δεν πρέπει να μεταδίδεται αδιακρίτως μέσα στον αέρα.
- Κονίαμα που παραμένει δεμένο σε πλευρικό ή βαθύτερο υλικό μπορεί να επιβιώσει της αφαίρεσης γειτονικού πηλού. Το αντίστροφο είναι επίσης δυνατό.
- Συσσώρευση ρωγμών μπορεί να αφήσει ένα τμήμα με λίγες συνδέσεις. Η αστοχία της τελευταίας επαρκούς σύνδεσης εξηγεί απότομη απελευθέρωση μετά από πολλά προηγούμενα χτυπήματα.

Οι παραπάνω εξηγήσεις είναι μοντελοποιητικές συνθέσεις, όχι ισχυρισμός πλήρους επίλυσης δυναμικής θραυστομηχανικής.

## Ηλεκτρολογικές αυλακώσεις και φωλιές κουτιών

Η International Masonry Society διαθέτει πρωτογενή μελέτη 12 τοίχων κοίλων κεραμικών μονάδων με οριζόντιες, κατακόρυφες και λοξές αυλακώσεις, σωλήνες και επαναπλήρωση. Η προσβάσιμη περίληψη περιγράφει το πειραματικό πρόγραμμα, όχι όλα τα αποτελέσματα.

- [Hollowed clay brick masonry elements with chases: behaviour under compression](https://www.masonry.org.uk/downloads/id1510-hollowed-clay-brick-masonry-elements-with-chases-behaviour-under-compression/)
- Περιορισμός: πλήρες paper επί πληρωμή. Δεν αποδίδονται αριθμητικά ή άλλα μη προσβάσιμα συμπεράσματα.

Ο επίσημος Porotherm Best Practice Guide περιγράφει πολυκυψελωτά μπλοκ και, για οπές στερέωσης, διάτρηση χωρίς κρουστική λειτουργία. Πρόκειται για οδηγία ελεγχόμενης κατασκευαστικής εγκατάστασης και όχι ισχυρισμό ότι η κατεδάφιση με καλέμι είναι αδύνατη.

- [Wienerberger Porotherm Best Practice Guide](https://www.wienerberger.co.uk/content/dam/wienerberger/united-kingdom/marketing/documents-magazines/commercial/UK_MKT_DOC_WAL_POR_Porotherm_Best_Practice_Guide.pdf)

Βρέθηκε επίσης τεχνικό έντυπο με σήμανση Wienerberger σε τρίτο host που περιγράφει προχάραξη με cutter και κατόπιν chip removal. Επειδή δεν επιβεβαιώθηκε από επίσημο host και η απευθείας φόρτωση απέτυχε, **δεν χρησιμοποιείται ως επαληθευμένη πρωτογενής απόδειξη ή ως απαίτηση αλλαγής του gameplay**.

Η εργασία του χρήστη απαιτεί ελεύθερη εκσκαφή από χτυπήματα. Η χωρητικότητα σωλήνων και κουτιών πρέπει να προκύπτει από την ίδια πραγματική κοιλότητα που βλέπει και χτυπά ο παίκτης. Ένα progress flag, σκοτεινό decal ή προϋπάρχον ορθογώνιο prefab δεν αποδεικνύει ότι ο χώρος έχει εκσκαφεί.

## Παρατηρήσεις στις οκτώ συνημμένες εικόνες

Οι παρατηρήσεις αφορούν τις ορατές τελικές καταστάσεις. Οι στατικές εικόνες δεν αποδεικνύουν ενέργεια κρούσης, αριθμό χτυπημάτων, προηγούμενη χρήση cutter ή κρυφές διαστάσεις.

1. `codex-clipboard-faf20f4a-70a4-41db-9deb-58fe653095af.png`: στην ίδια κατακόρυφη εκσκαφή συνυπάρχουν ευρείες εναπομείνασες λωρίδες πρόσοψης, ανοίγματα σε κυψέλες, μερικώς αποκομμένες νευρώσεις και γκρι υπολείμματα κονιάματος. Διαφορετικές γειτονικές μονάδες έχουν διαφορετικό ποσοστό αφαίρεσης.
2. `codex-clipboard-5189264e-2933-4e8b-affd-bf4f28121818.png`: τοπικές μικρές οπές και ακανόνιστες ρωγμοειδείς απώλειες στην πρόσοψη συνυπάρχουν με βαθύτερη εκσκαφή γύρω από κουτιά. Το περίγραμμα δεν ακολουθεί ένα τέλειο ενιαίο ορθογώνιο.
3. `codex-clipboard-28ef993c-8be2-402f-931c-439740d2cf03.jpg`: κατακόρυφη αυλάκωση πολλών σωλήνων με μεταβλητό πλάτος/βάθος, ακανόνιστα χείλη επιχρίσματος, άθικτες περιοχές πηλού και μακρόστενες οπές. Οι σωλήνες καλύπτουν μέρος του εσωτερικού, συνεπώς δεν υποθέτουμε αόρατη γεωμετρία.
4. `codex-clipboard-4edebb28-c92e-4cc6-8ff5-381f73a241fc.png`: μικτές λοξές και κατακόρυφες αυλακώσεις, μεγαλύτερη εκσκαφή κοντά στη συστοιχία κουτιών, επιλεκτικές οπές και σωρός θραυσμάτων διαφορετικού μεγέθους/χρώματος. Οι πορείες των σωλήνων δεν συνεπάγονται αυτόματο carving της ίδιας καμπύλης.
5. `codex-clipboard-967b49c7-3777-4d1a-9d22-0a2d716ba8b4.jpg`: πιστολέτο με επίπεδο καλέμι σε ευρύτερη αποξήλωση τοιχοποιίας· διακρίνονται υπολείμματα τούβλου και κονιάματος. Η τοιχοποιία διαφέρει οπτικά από τις πρώτες εικόνες και δεν χρησιμοποιείται ως απόδειξη της ίδιας εσωτερικής κυψελωτής διάταξης. Περιέχει watermark και δεν προτείνεται ως ενσωματωμένο game asset.
6. `codex-clipboard-2bd60ffe-f569-475e-bd67-8dd27e68fbd4.jpg`: μικρής ανάλυσης αναφορά πιστολέτου σε βαθύτερη αφαίρεση· χρήσιμη για γενική σχέση εργαλείου/τοίχου/συντριμμιών, ανεπαρκής για ακριβή τοπολογία ρωγμών.
7. `codex-clipboard-0b09e794-9086-44fd-a4a5-f2e253440a24.jpg`: μικρής ανάλυσης όρθια χρήση πιστολέτου σε τοίχο και ακανόνιστη εκσκαφή. Δεν εξάγονται αριθμητικές παράμετροι εργαλείου ή υλικού.
8. `codex-clipboard-851d74a9-fa76-447b-b39c-7767b00a6494.jpg`: φαίνεται αντίγραφο της εικόνας 6· δεν μετρά ως ανεξάρτητο πείραμα/παρατήρηση.

Στο ορατό σύνολο των οκτώ εικόνων δεν εντοπίστηκε καθαρό gameplay screenshot με το περιγραφόμενο παλιό dent. Η αρνητική συμπεριφορά προκύπτει από τη ρητή περιγραφή του χρήστη και πρέπει να επιβεβαιωθεί χωριστά στο τρέχον runtime/πηγαίο κώδικα. Δεν αποδίδεται αυθαίρετα σε κάποια κατασκευαστική φωτογραφία.

## Μηχανικές συνέπειες και κριτήρια αποδοχής

- Κάθε κρούση αρχίζει από την πραγματική επαφή της άκρης/κόψης και χρησιμοποιεί κατεύθυνση, προσανατολισμό και τρέχουσα γεωμετρία.
- Η τοπική ζώνη σύνθλιψης μπορεί να είναι μικρότερη από τη ζώνη ρωγμών και από ένα μεταγενέστερα αποκολλώμενο κομμάτι.
- Το πεδίο αναζητά υλικό σε παγκόσμιες/χωρικές συντεταγμένες και διασταυρώνει όρια μονάδων χωρίς να υποχρεώνει τη ρωγμή να ακολουθεί ή να αγνοεί όλους τους αρμούς.
- Εσωτερικά κενά υπάρχουν πριν από το χτύπημα. Η αφαίρεση του κελύφους τα αποκαλύπτει· δεν προσθέτει διακοσμητικό μαύρο επίπεδο.
- Μία νεύρωση μπορεί να αστοχεί ανεξάρτητα, με γειτονικές νευρώσεις ακόμη ορατές και λειτουργικές.
- Εναπομείναντες δεσμοί/στήριξη και ιστορικό ρωγμών επηρεάζουν την απελευθέρωση μεγαλύτερων κομματιών. Κάθε κρούση δεν χρειάζεται έκρηξη.
- Controlled seeds δίνουν παρόμοια μακροσκοπική εξέλιξη με διαφορετικές λεπτομέρειες ανά φρέσκο τοίχο και δυνατότητα αναπαραγωγής για tests.
- Τα chips/debris αποδίδουν μικρό μέρος της αφαιρεμένης ύλης. Η αφαίρεση όγκου παραμένει όταν αυτά κοιμηθούν ή καθαριστούν.
- Το υπόλοιπο τοιχίο έχει πραγματικές σπασμένες επιφάνειες, όχι ομαλές προεκτάσεις της πρόσοψης μέσα σε λακκούβα.
- Render, κονίαμα, κοίλος πηλός και δομικό σκυρόδεμα δεν μοιράζονται μία καθολική μορφή εσωτερικού ή μία ταχύτητα εκσκαφής. Οι τιμές αντοχής είναι παράμετροι του παιχνιδιού μέχρι να βαθμονομηθούν.
- Η ίδια εναπομείνασα ύλη καθορίζει rendering, επόμενα hits, collision και δυνατότητα τοποθέτησης κουτιού/σωλήνα. Οπτική απουσία χωρίς αντίστοιχη γεωμετρική/χωρική αλήθεια αποτυγχάνει την απαίτηση.

Η πιστότητα αυτών των συνεπειών ελέγχεται με πραγματικό gameplay, διαδοχικά χτυπήματα και ορατές ενδιάμεσες καταστάσεις. Ένα επιτυχημένο build ή μόνο ένα τελικό screenshot δεν αποδεικνύει την απαιτούμενη εξέλιξη.

## Algorithm evaluation and selected architecture

The live stack is TypeScript/Vite, Three.js 0.180 and WebGL, with a custom bounded debris solver. The existing wall was 6 × 3 × 0.18 m. Algorithm research completed before code changes, alongside the material investigation above.

| Method | Partial/hollow/cross-unit behavior | Cost and decision |
|---|---|---|
| FEM dynamic fracture + local remeshing | Strong physical crack initiation and evolving fragment topology | Full stress integration, remeshing, collision and calibration exceed a defensible browser implementation here; not rejected simply for convenience. No measured mobile feasibility available. |
| Local convex clipping / dynamic fracture | Angular pieces, genuine volume, good local precision | Strong alternative; maintaining watertight thin webs and updated adjacency after hundreds of intersections is substantial. Could refine selected volume fragments in future. |
| Runtime mesh CSG | Real arbitrary subtraction across multiple solids | `three-bvh-csg` is experimental with watertight/manifold requirements and documented precision corner cases. Manifold WASM is stronger for robust booleans but adds conversions and does not provide cracks/support/damage history itself. |
| Sparse voxels | Straightforward hollow topology, persistent material, cross-brick contact and shared collision/fit queries | Selected storage principle. Exposed cube rendering rejected. Fine lattice and faceted tetrahedral extraction address partial thin elements. |
| Smooth SDF | Real volume and convenient local operations | Smooth subtractive blobs can reproduce bowls; thin webs need enough samples. No smoothing/deforming distance field used for surviving surfaces. |
| Voronoi/prefracture | Fast angular chunks and bonds | Fixed patterns and piece size limit precise electrical excavation; unsuitable as whole-brick toggle. Only fine deterministic material heterogeneity is used. |
| Fracture graphs | Weakening, connection failure and larger island release | Selected connectivity/weakness principle, combined with geometry because graphs alone do not define cavities. |
| Procedural shells/ribs + volumetric damage | Existing cavities revealed by local shell loss, ribs survive independently | Selected hybrid. Brick labels influence initial material only; world-space impacts operate across joints. |
| Decals/particles/shader clipping | Cheap cracks/dust | Supplement only. All removal, next contacts and installation clearance derive from the changed volume. |

Primary algorithm sources:

- [O'Brien & Hodgins: Graphical Modeling and Animation of Brittle Fracture](https://graphics.berkeley.edu/papers/Obrien-GMA-1999-08/) — finite-element crack initiation and propagation.
- [Müller et al.: Real Time Dynamic Fracture with Volumetric Approximate Convex Decompositions](https://matthias-research.github.io/pages/publications/fractureSG2013.pdf) — local runtime fracture and the limitations of fixed prefractures.
- [three-bvh-csg repository and requirements](https://github.com/gkjohnson/three-bvh-csg) and [Manifold](https://github.com/elalish/manifold) — browser CSG tradeoffs.
- [OpenVDB overview](https://www.openvdb.org/documentation/doxygen/overview.html) — sparse volumetric topology/storage principle; no OpenVDB binary dependency introduced.
- [Dual Contouring of Hermite Data](https://www.cs.rice.edu/~jwarren/papers/dualcontour.pdf) — sharp-feature surface extraction comparison; this implementation uses a fixed tetrahedral binary-material boundary instead of solving Hermite QEFs.
- [Blast introduction](https://docs.omniverse.nvidia.com/kit/docs/blast-sdk/latest/docs/api/introduction.html) and [stress extension](https://nvidia-omniverse.github.io/PhysX/blast/docs/api/extensions/ext_stress.html) — bond damage/island separation reference, not an imported PhysX simulation.
- [Three.js BufferGeometry](https://threejs.org/docs/pages/BufferGeometry.html), [InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html), [BVH topology caveats](https://github.com/gkjohnson/three-mesh-bvh/blob/master/API.md), [transferable worker buffers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects).

The selected system is a gameplay approximation with measurable local budgets, not a calibrated material fracture solver. Its non-negotiable distinction from the old heightfield is that solid → air → rib → air → rear shell exists before impact. Losing material changes topology; the unbroken lattice never moves inward. The former `demolitionResponse`, `surfaceInsetAt`, `deformation*`, retained brick-origin targeting and four-route-pass carving are removed from `BrickWall.ts`.
